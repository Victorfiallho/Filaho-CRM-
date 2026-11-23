// Which loads failed, for the "couldn't load" banner (QueryErrorBanner).
// Only queries a screen is using right now count: a failed query nobody
// shows anymore is not the visitor's problem. Pure, so it's testable
// without React Query's cache.

export interface QueryLike {
  state: { status: string };
  getObserversCount(): number;
}

export function failedActiveQueries<Q extends QueryLike>(queries: Q[]): Q[] {
  return queries.filter(q => q.state.status === "error" && q.getObserversCount() > 0);
}
