-- Run in Supabase SQL editor. All callable functions use caller privileges and auth.uid().
create function public.library_fold(value text) returns text
language sql immutable parallel safe as $$
  select replace(regexp_replace(normalize(lower(coalesce(value, '')), NFD), U&'[\0300-\036F]', '', 'g'), 'ς', 'σ')
$$;

-- Trigrams keep substring search indexable without a required extension.
create function public.library_trigrams(value text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct substring(token from n for 3)), array[]::text[])
  from regexp_split_to_table(public.library_fold(value), '\s+') token
  cross join lateral generate_series(1, greatest(length(token)-2, 0)) n
$$;

create function public.library_search_text(book jsonb) returns text
language sql immutable parallel safe as $$
  select public.library_fold(concat_ws(' ', book->>'title', book->>'author', book->>'isbn',
    book->>'category', book->>'subcategory',
    (select string_agg(tag, ' ') from jsonb_array_elements_text(coalesce(book->'tags','[]'::jsonb)) tag),
    (select string_agg(copy->>'location', ' ') from jsonb_array_elements(coalesce(book->'copies','[]'::jsonb)) copy)))
$$;

create table public.library_books (
  id uuid not null,
  owner_id uuid not null default auth.uid(),
  document jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (public.library_search_text(document)) stored,
  primary key (owner_id, id),
  constraint document_object check (jsonb_typeof(document) = 'object'),
  constraint document_id check ((document->>'id')::uuid = id),
  constraint document_title check (length(trim(coalesce(document->>'title',''))) > 0)
);
create index library_books_owner_created on public.library_books (owner_id, created_at desc, id);
create index library_books_owner_category on public.library_books (owner_id, (document->>'category'));
create index library_books_search_grams on public.library_books using gin (public.library_trigrams(search_text));
alter table public.library_books enable row level security;
alter table public.library_books force row level security;
create policy library_owner_select on public.library_books for select to authenticated using (owner_id = auth.uid());
create policy library_owner_insert on public.library_books for insert to authenticated with check (owner_id = auth.uid());
create policy library_owner_update on public.library_books for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy library_owner_delete on public.library_books for delete to authenticated using (owner_id = auth.uid());
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.library_books to authenticated;
revoke all on public.library_books from anon;

create table public.library_goals (
  owner_id uuid primary key default auth.uid(),
  goals jsonb not null default '{}'::jsonb check (jsonb_typeof(goals) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.library_goals enable row level security;
alter table public.library_goals force row level security;
create policy library_goals_select on public.library_goals for select to authenticated using (owner_id = auth.uid());
create policy library_goals_insert on public.library_goals for insert to authenticated with check (owner_id = auth.uid());
create policy library_goals_update on public.library_goals for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.library_goals to authenticated;
revoke all on public.library_goals from anon;

create function public.library_save(p_book jsonb, p_expected_revision integer default 0) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  book_id uuid;
  existing public.library_books%rowtype;
  clean jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(p_book) <> 'object' or p_book->>'title' is null or trim(p_book->>'title') = ''
     or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid book' using errcode = '22023';
  end if;
  book_id := (p_book->>'id')::uuid;
  clean := p_book - 'owner_id' - 'ownerId' - 'revision';
  insert into public.library_books (id, owner_id, document, revision)
    values (book_id, auth.uid(), clean, 1)
    on conflict (owner_id, id) do nothing;
  select * into existing from public.library_books where owner_id = auth.uid() and id = book_id for update;
  if not found then raise exception 'Save failed' using errcode = 'P0001'; end if;
  -- A lost HTTP acknowledgment can be retried with the exact same document.
  if existing.document = clean then
    return jsonb_build_object('ok', true, 'book', existing.document || jsonb_build_object('revision', existing.revision));
  end if;
  if existing.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'remote', existing.document || jsonb_build_object('revision', existing.revision));
  end if;
  update public.library_books set document = clean, revision = revision + 1, updated_at = now()
    where owner_id = auth.uid() and id = book_id
    returning * into existing;
  return jsonb_build_object('ok', true, 'book', existing.document || jsonb_build_object('revision', existing.revision));
end
$$;

create function public.library_search(p_query text default '', p_category text default '', p_status text default '',
  p_ownership text default '', p_offset integer default 0, p_limit integer default 24, p_archived boolean default false)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with filtered as (
    select b.* from public.library_books b
    where b.owner_id = auth.uid()
      and (p_archived is null or coalesce((b.document->>'archived')::boolean, false) = p_archived)
      and (coalesce(p_category,'') = '' or b.document->>'category' = p_category)
      and (coalesce(p_ownership,'') = '' or exists (
        select 1 from jsonb_array_elements(coalesce(b.document->'copies','[]'::jsonb)) c
        where c->>'ownership' = p_ownership))
      and (coalesce(p_status,'') = '' or (
        select r->>'status' from jsonb_array_elements(coalesce(b.document->'readings','[]'::jsonb)) with ordinality v(r,n)
        order by (r->>'status' in ('reading','paused')) desc, n desc limit 1) = p_status)
      and public.library_trigrams(b.search_text) @> public.library_trigrams(p_query)
      and not exists (
        select 1 from unnest(string_to_array(trim(regexp_replace(public.library_fold(p_query),'\s+',' ','g')), ' ')) token
        where token <> '' and position(token in b.search_text) = 0)
  ), page as (
    select document || jsonb_build_object('revision', revision) as item from filtered
    order by created_at desc, id limit least(greatest(coalesce(p_limit,24),1),200)
    offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object('items', coalesce((select jsonb_agg(item) from page),'[]'::jsonb),
    'total', (select count(*) from filtered))
$$;

create function public.library_stats(p_year integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with books as (
    select document from public.library_books where owner_id = auth.uid() and not coalesce((document->>'archived')::boolean,false)
  ), sessions as (
    select b.document, r.value as reading from books b
    cross join lateral jsonb_array_elements(coalesce(b.document->'readings','[]'::jsonb)) r
    where r.value->>'status' = 'finished' and substring(r.value->>'finishedAt' from 1 for 4) = p_year::text
  ), months as (
    select generate_series(1,12) as month
  )
  select jsonb_build_object(
    'total', (select count(*) from books),
    'reading', (select count(*) from books b where (
      select r->>'status' from jsonb_array_elements(coalesce(b.document->'readings','[]'::jsonb)) with ordinality v(r,n)
      order by (r->>'status' in ('reading','paused')) desc, n desc limit 1) = 'reading'),
    'finished', (select count(*) from sessions),
    'owned', (select count(*) from books where exists (select 1 from jsonb_array_elements(coalesce(document->'copies','[]'::jsonb)) c where c->>'ownership' = 'owned')),
    'loaned', (select count(*) from books b cross join lateral jsonb_array_elements(coalesce(b.document->'copies','[]'::jsonb)) c where trim(coalesce(c->>'loanTo','')) <> ''),
    'pages', (select coalesce(sum(coalesce((document->>'pageCount')::integer,0)),0) from sessions),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name',name,'count',n) order by n desc,name) from
       (select coalesce(nullif(document->>'category',''),'Άλλο') name, count(*) n from books group by 1) categories),'[]'::jsonb),
    'monthly', (select jsonb_agg((select count(*) from sessions where substring(reading->>'finishedAt' from 6 for 2)::integer = month) order by month) from months)
  )
$$;

create function public.library_recommendations(p_limit integer default 6) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb) from (
    select document || jsonb_build_object('revision',revision) as item
    from public.library_books b
    where owner_id = auth.uid() and not coalesce((document->>'archived')::boolean,false)
      and exists (select 1 from jsonb_array_elements(coalesce(document->'copies','[]'::jsonb)) c where c->>'ownership' = 'owned')
      and not exists (select 1 from jsonb_array_elements(coalesce(document->'readings','[]'::jsonb)) r where (r->>'status' <> 'want' or coalesce((r->>'currentPage')::integer,0) > 0))
    order by case when exists (select 1 from jsonb_array_elements(coalesce(document->'readings','[]'::jsonb)) r where r->>'status' = 'want') then 0 else 1 end,
      created_at, id limit least(greatest(coalesce(p_limit,6),1),24)
  ) ranked
$$;

create function public.library_get_goals() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select goals from public.library_goals where owner_id = auth.uid()), '{}'::jsonb)
$$;

create function public.library_save_goals(p_goals jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare saved jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(p_goals) <> 'object' then raise exception 'Invalid goals' using errcode = '22023'; end if;
  insert into public.library_goals (owner_id, goals) values (auth.uid(), p_goals)
  on conflict (owner_id) do update set goals = public.library_goals.goals || excluded.goals, updated_at = now()
  returning goals into saved;
  return jsonb_build_object('ok', true, 'goals', saved);
end
$$;

revoke all on function public.library_fold(text) from public, anon;
revoke all on function public.library_trigrams(text) from public, anon;
revoke all on function public.library_search_text(jsonb) from public, anon;
revoke all on function public.library_save(jsonb, integer) from public, anon;
revoke all on function public.library_search(text,text,text,text,integer,integer,boolean) from public, anon;
revoke all on function public.library_stats(integer) from public, anon;
revoke all on function public.library_recommendations(integer) from public, anon;
revoke all on function public.library_get_goals() from public, anon;
revoke all on function public.library_save_goals(jsonb) from public, anon;
grant execute on function public.library_fold(text) to authenticated;
grant execute on function public.library_trigrams(text) to authenticated;
grant execute on function public.library_search_text(jsonb) to authenticated;
grant execute on function public.library_save(jsonb, integer) to authenticated;
grant execute on function public.library_search(text,text,text,text,integer,integer,boolean) to authenticated;
grant execute on function public.library_stats(integer) to authenticated;
grant execute on function public.library_recommendations(integer) to authenticated;
grant execute on function public.library_get_goals() to authenticated;
grant execute on function public.library_save_goals(jsonb) to authenticated;
