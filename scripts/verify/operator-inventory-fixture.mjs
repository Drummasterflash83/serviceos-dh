export function database(records = {}, transform = (r) => r, cap = 137) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(records[table] ?? [])],
        columns = [],
        head = false,
        limit = Infinity;
      const c = { table, head: false };
      const q = {};
      q.select = (text, opts) => {
        columns = text.split(",").map((s) => s.trim());
        head = opts?.head === true;
        c.head = head;
        return q;
      };
      q.eq = (k, v) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      };
      q.lte = (k, v) => {
        rows = rows.filter((r) => Date.parse(r[k]) <= Date.parse(v));
        return q;
      };
      q.or = (text) => {
        const cutoff = text.slice("effective_to.is.null,effective_to.gt.".length);
        rows = rows.filter(
          (r) => r.effective_to === null || Date.parse(r.effective_to) > Date.parse(cutoff),
        );
        return q;
      };
      q.gt = (k, v) => {
        rows = rows.filter((r) => r[k] > v);
        c.cursor = v;
        return q;
      };
      q.order = (k) => {
        rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
        return q;
      };
      q.limit = (v) => {
        limit = v;
        return q;
      };
      q.maybeSingle = async () => transform({ data: rows[0] ?? null, error: null }, c, calls);
      q.then = (resolve, reject) => {
        calls.push(c);
        const data = rows
          .slice(0, Math.min(limit, cap))
          .map((r) => Object.fromEntries(columns.map((k) => [k, r[k]])));
        return Promise.resolve(
          transform({ data: head ? null : data, count: rows.length, error: null }, c, calls),
        ).then(resolve, reject);
      };
      return q;
    },
  };
}
