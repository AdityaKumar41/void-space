/** Keep the application chrome out of authenticated lesson authoring and playback routes. */
export function isLessonPlaygroundRoute(pathname: string) {
  return (
    /^\/console\/learn\/library\/[^/]+\/annotate\/?$/.test(pathname) ||
    /^\/console\/learn\/(?:drafts|lessons)\/[^/]+\/?$/.test(pathname)
  );
}
