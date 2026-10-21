/**
 * FitGymSoftware export — runs INSIDE the logged-in control.fitgymsoftware.com
 * tab (pasted into the console or injected), never in Node.
 *
 * It calls the same API the web app calls, with the session already in the
 * page, and POSTs every response to receiver.ts on 127.0.0.1:4599, which
 * writes it to backups/fitgym/. See receiver.ts for why it is split this way.
 *
 * Usage, in the page:
 *   await __fg.snapshots()            // all bulk lists (~60 requests)
 *   __fg.run('profiles')              // one request per member
 *   __fg.stop = true                  // ends the current run after the batch
 *   __fg.status                       // progress; also saved as status.json
 *
 * Each run asks the receiver which keys it already has and skips them, so
 * re-running after a reload, logout or crash picks up where it stopped.
 *
 * PACING. Two requests in flight at most, each worker pausing 350–850 ms
 * between calls (~3 req/s). A 429 or 5xx backs off for 20 s, then 60 s, then
 * 3 min before giving up on that key. A 401/403 stops everything: the session
 * has ended and nothing should be retried until someone logs back in.
 */
(() => {
  const API = 'https://api.fitgymsoftware.in';
  const RX = 'http://127.0.0.1:4599';
  const WORKERS = 2;
  const BATCH = 20;
  const PAGE = 500;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => 350 + Math.random() * 500;

  class LoggedOut extends Error {}

  const fg = (window.__fg = { stop: false, status: { phase: 'idle' } });

  async function api(path, body) {
    const delays = [20000, 60000, 180000];
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(API + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            // Read every call: the app refreshes this key when it renews
            // the session, and a stale copy would 401 the rest of the run.
            Authorization: 'Bearer ' + localStorage.getItem('JWT_TOKEN'),
            backendversion: '1.30.0',
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        res = { status: 0, statusText: String(err) };
      }
      if (res.status === 401 || res.status === 403) throw new LoggedOut(`HTTP ${res.status} on ${path}`);
      if (res.status === 200) {
        const json = await res.json();
        if (json.success !== 1) throw new Error(`success=${json.success} on ${path}`);
        return json.data;
      }
      if (attempt >= delays.length) throw new Error(`HTTP ${res.status} on ${path} after retries`);
      fg.status.lastBackoff = `${new Date().toISOString()} HTTP ${res.status} ${path}`;
      await sleep(delays[attempt]);
    }
  }

  async function rx(method, route, name, body) {
    const res = await fetch(`${RX}${route}?name=${name}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`receiver ${res.status} on ${route} ${name}`);
    return res.json();
  }

  async function paged(path, body, listKey) {
    const rows = [];
    let total = Infinity;
    for (let pageIndex = 0; rows.length < total; pageIndex++) {
      const data = await api(path, { ...body, pageIndex, pageSize: PAGE });
      total = data.totalRecordCount;
      const page = data[listKey];
      if (!page || page.length === 0) break;
      rows.push(...page);
      fg.status.snapshot = `${path} ${rows.length}/${total}`;
      await sleep(1500);
    }
    return { totalRecordCount: total, rows };
  }

  const MEMBER_LIST_BODY = {
    sortByColumnName: 'id', sortPreference: 'ASC', filterString: null,
    textfieldOne: null, memberTextFieldTwo: null, memberTextFieldThree: null,
    profilePhotoAvailability: 'NONE', gender: null, allowToSendSMS: null, rfIdCard: null,
    memberType: null, listOfGroupIds: null, listOfSourceIds: null, listOfFieldOneIds: null,
    listOfDropdownFieldTwoIds: null, listOfDropdownFieldThreeIds: null, listOfBloodGroups: null,
    listOfOccupationIds: null, listOfAddedByStaffIds: null, reminderFrom: null, reminderTo: null,
    dobFrom: null, dobTo: null, datetimeCreatedFrom: null, datetimeCreatedTo: null,
    lastSeenInMemberPortalFrom: null, lastSeenInMemberPortalTo: null, isMemberAppInstalled: null,
    isOccupationNeeded: true, isSourceNeeded: true, isGroupNeeded: true,
    isFieldOneNeeded: true, isFieldTwoNeeded: true, isFieldThreeNeeded: true,
  };

  const MEMBERSHIP_LIST_BODY = {
    sortByColumnName: 'id', sortPreference: 'ASC', filterString: null,
    startDatetimeFrom: null, startDatetimeTo: null, endDateFrom: null, endDateTo: null,
    listOfGroupIds: null, listOfTrainerIds: null, listOfDropdownfieldOneIds: null,
    listOfMasterMembershipIds: null, listOfMembershipStatus: null, isRenewal: null,
    listOfStaffIds: null, gender: null,
    isGroupNeeded: true, isTrainerNeeded: true, isDropdownFieldOneNeeded: true,
  };

  const ALL_TIME = { from: '2000-01-01T00:00:00.000Z', to: '2035-01-01T00:00:00.000Z' };

  const SNAPSHOTS = {
    members: () => paged('/members/paginationV2', MEMBER_LIST_BODY, 'memberList'),
    memberships: () => paged('/memberships/paginationV2', MEMBERSHIP_LIST_BODY, 'membershipList'),
    invoices: () =>
      paged('/finance/invoices-pagination', {
        sortByColumnName: 'id', sortPreference: 'ASC', filterString: null,
        txnDatetimeFrom: ALL_TIME.from, txnDatetimeTo: ALL_TIME.to,
        listOfPaymentModeIds: null, tax: null, listOfMemberIds: null,
        listOfCollectedByStaffIds: null, listOfTrainerIds: null, listOfGroupIds: null,
      }, 'invoiceList'),
    freezes: () =>
      paged('/memberships/freeze-info-for-all-memberships-pagination',
        { sortByColumnName: 'id', sortPreference: 'ASC', filterString: null }, 'freezeInfoList'),
    'master-memberships': () => api('/master-memberships'),
    groups: () => api('/groups'),
    'invoice-prerequisites': () =>
      api('/finance/invoices-pagination-prerequisites?isAppCacheAvailableStaffListWithDeleted=false' +
        '&isAppCacheAvailablePaymentModeListWithDeleted=false&isAppCacheAvailableGroupListWithDeleted=false' +
        '&invoiceGroupFilter=false'),
    'membership-prerequisites': () =>
      api('/memberships/pagination-prerequisites?memberGroupFilter=false&enableMemberMembershipDropdownFieldOne=false' +
        '&isAppCacheAvailableMasterMembershipListWithDeleted=false&isAppCacheAvailableGroupListWithDeleted=false' +
        '&isAppCacheAvailableTrainerListWithDeleted=false&isAppCacheAvailableMembershipStatusList=false' +
        '&isAppCacheAvailableStaffListWithDeleted=false' +
        '&isAppCacheAvailableMemberMembershipDropdownFieldOneListWithDeleted=false'),
  };

  fg.snapshots = async (names = Object.keys(SNAPSHOTS)) => {
    fg.status = { phase: 'snapshots', done: [] };
    for (const name of names) {
      const data = await SNAPSHOTS[name]();
      await rx('POST', '/snapshot', name, { fetchedAt: new Date().toISOString(), data });
      fg.status.done.push(`${name}:${data.rows ? data.rows.length : Array.isArray(data) ? data.length : 'obj'}`);
      await sleep(1000);
    }
    fg.status.phase = 'snapshots done';
    return fg.status;
  };

  // Per-record fetchers. Each maps a key to the data stored for it. Body
  // measurements, follow-ups, attendance, gift days and transfers exist in
  // the old system too but are out of scope for the migration.
  const KINDS = {
    profiles: {
      keys: async () => (await rx('GET', '/snapshot', 'members')).data.rows.map((m) => m.id),
      fetch: (id) => api(`/members/profileV2?id=${id}`),
    },
  };

  fg.run = async (kind, explicitKeys) => {
    fg.stop = false;
    const spec = KINDS[kind];
    const all = explicitKeys ?? (await spec.keys());
    const have = new Set(await rx('GET', '/done', kind));
    const queue = all.filter((k) => !have.has(String(k)));
    const started = Date.now();
    const st = (fg.status = {
      phase: `running ${kind}`, kind, total: all.length, alreadyHad: all.length - queue.length,
      fetched: 0, failed: [], startedAt: new Date(started).toISOString(),
    });
    let pending = [];
    let flushing = Promise.resolve();

    const flush = () => {
      const batch = pending;
      pending = [];
      flushing = flushing.then(async () => {
        if (batch.length) await rx('POST', '/records', kind, batch);
        st.ratePerMin = Math.round((st.fetched / (Date.now() - started)) * 60000);
        st.remaining = queue.length;
        await rx('POST', '/snapshot', 'status', st);
      });
      return flushing;
    };

    const worker = async () => {
      while (queue.length && !fg.stop) {
        const key = queue.shift();
        try {
          pending.push({ key, data: await spec.fetch(key) });
          st.fetched++;
        } catch (err) {
          if (err instanceof LoggedOut) {
            fg.stop = true;
            queue.unshift(key);
            st.phase = `STOPPED — logged out (${err.message})`;
            break;
          }
          st.failed.push({ key, error: String(err.message || err) });
        }
        if (pending.length >= BATCH) await flush();
        await sleep(jitter());
      }
    };

    await Promise.all(Array.from({ length: WORKERS }, worker));
    await flush();
    if (!st.phase.startsWith('STOPPED')) st.phase = fg.stop ? `paused ${kind}` : `done ${kind}`;
    await rx('POST', '/snapshot', 'status', st);
    return st;
  };
})();
