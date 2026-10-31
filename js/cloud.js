const SESSION_PREFIX = 'booktracker.supabase.session:';

function validKey(key) {
  if (typeof key !== 'string' || !key.trim() || /^sb_secret_/i.test(key)) return false;
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch { return false; }
}

function validateSession(value) {
  return value && typeof value.access_token === 'string' && typeof value.refresh_token === 'string' &&
    typeof value.user?.id === 'string' ? value : null;
}

export class CloudClient {
  constructor({ url, key, storage = globalThis.localStorage, fetchImpl = globalThis.fetch } = {}) {
    let endpoint;
    try { endpoint = new URL(url); } catch { throw new Error('Invalid Supabase URL'); }
    if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
      throw new Error('Invalid Supabase URL');
    }
    if (!validKey(key)) throw new Error('Supabase secret or service key is not allowed');
    this.url = endpoint.origin;
    this.sessionKey = SESSION_PREFIX + endpoint.hostname;
    this.key = key;
    this.storage = storage;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.session = null;
    this.refreshPromise = null;
  }

  async #request(path, { method = 'GET', body, auth = true, headers = {}, timeout = 15000 } = {}) {
    if (auth) await this.#ensureSession();
    const response = await this.fetchImpl(this.url + path, {
      method,
      signal: AbortSignal.timeout(timeout),
      headers: {
        apikey: this.key,
        ...(auth ? { Authorization: `Bearer ${this.session.access_token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || data?.error_description || `Cloud HTTP ${response.status}`);
      error.status = response.status;
      error.code = data?.code || data?.error_code;
      throw error;
    }
    return data;
  }

  #remember(data) {
    const session = validateSession(data);
    if (!session) throw new Error('Supabase did not return a valid session');
    this.session = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
      user: { id: session.user.id, email: session.user.email || '' }
    };
    this.storage?.setItem(this.sessionKey, JSON.stringify(this.session));
    return this.session;
  }

  async signIn(email, password) {
    const data = await this.#request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    return this.#remember(data);
  }

  async signOut() {
    try {
      if (this.session) await this.#request('/auth/v1/logout', { method: 'POST' });
    } finally {
      this.session = null;
      this.storage?.removeItem(this.sessionKey);
    }
  }

  async restoreSession() {
    if (!this.session) {
      try { this.session = validateSession(JSON.parse(this.storage?.getItem(this.sessionKey) || 'null')); }
      catch { this.session = null; }
    }
    if (!this.session) return null;
    await this.#ensureSession();
    return this.session;
  }

  async #ensureSession() {
    if (!this.session) throw new Error('Cloud sign-in required');
    if (this.session.expires_at > Math.floor(Date.now() / 1000) + 60) return;
    if (!this.refreshPromise) {
      const refresh = this.session.refresh_token;
      this.refreshPromise = (async () => {
        try {
          const data = await this.#request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: refresh } });
          this.#remember(data);
        } catch (error) {
          if (error.status === 400 || error.status === 401) {
            this.session = null;
            this.storage?.removeItem(this.sessionKey);
          }
          throw error;
        }
      })().finally(() => { this.refreshPromise = null; });
    }
    await this.refreshPromise;
  }

  async #rpc(name, body) {
    return this.#request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  }

  async recognizeCover(image) {
    const data = await this.#request('/functions/v1/recognize-cover', { method: 'POST', body: { image }, timeout: 35000 });
    if (!data || typeof data.title !== 'string' || !data.title.trim()) throw new Error('Δεν αναγνωρίστηκε τίτλος. Δοκίμασε καθαρότερη φωτογραφία.');
    return data;
  }

  async search({ query = '', category = '', status = '', ownership = '', offset = 0, limit = 24, archived = false } = {}) {
    const data = await this.#rpc('library_search', {
      p_query: query, p_category: category, p_status: status, p_ownership: ownership,
      p_offset: Math.max(0, Math.floor(offset)), p_limit: Math.min(200, Math.max(1, Math.floor(limit))), p_archived: archived
    });
    if (!data || !Array.isArray(data.items) || !Number.isInteger(data.total)) throw new Error('Cloud search returned invalid data');
    return data;
  }

  async get(id) {
    const data = await this.#request(`/rest/v1/library_books?id=eq.${encodeURIComponent(id)}&select=document,revision&limit=1`);
    if (!Array.isArray(data)) throw new Error('Cloud get returned invalid data');
    return data[0] ? { ...data[0].document, revision: data[0].revision } : null;
  }

  async save(book, expectedRevision = 0) {
    const { owner_id, ownerId, revision, ...document } = book;
    const data = await this.#rpc('library_save', { p_book: document, p_expected_revision: expectedRevision });
    if (data?.code === 'CONFLICT') {
      const error = new Error('Cloud revision conflict');
      error.code = 'CONFLICT';
      error.remote = data.remote;
      throw error;
    }
    if (data?.ok !== true || !data.book || data.book.id !== book.id || !Number.isInteger(data.book.revision) || data.book.revision < 1) {
      throw new Error('Cloud save missing confirmation');
    }
    return data.book;
  }

  async stats(year = new Date().getFullYear()) {
    return this.#rpc('library_stats', { p_year: year });
  }

  async recommendations(limit = 6) {
    const data = await this.#rpc('library_recommendations', { p_limit: Math.min(24, Math.max(1, Math.floor(limit))) });
    if (!Array.isArray(data)) throw new Error('Cloud recommendations returned invalid data');
    return data;
  }

  async getGoals() {
    const data = await this.#rpc('library_get_goals', {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Cloud goals returned invalid data');
    return data;
  }

  async saveGoals(goals) {
    if (!goals || typeof goals !== 'object' || Array.isArray(goals)) throw new Error('Invalid goals');
    const data = await this.#rpc('library_save_goals', { p_goals: goals });
    if (data?.ok !== true || !data.goals || typeof data.goals !== 'object' || Array.isArray(data.goals)) {
      throw new Error('Cloud goals missing confirmation');
    }
    return data.goals;
  }

  async *all() {
    let offset = 0;
    for (;;) {
      const page = await this.search({ offset, limit: 200, archived: null });
      for (const item of page.items) yield item;
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) return;
    }
  }
}
