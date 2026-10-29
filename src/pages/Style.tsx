import { StyleEditor, StyleEditorSkeleton } from "../overlay/StyleEditor";

// On the widest screens, the controls make one column and the Preview the
// other.
const COLUMNS =
  "flex flex-col gap-4 2xl:grid 2xl:grid-cols-[30rem_minmax(0,1fr)] 2xl:items-start 2xl:gap-x-6";

export function Style() {
  return (
    <div className={COLUMNS}>
      <StyleEditor />
    </div>
  );
}

export function StyleSkeleton() {
  return (
    <div className={COLUMNS}>
      <StyleEditorSkeleton />
    </div>
  );
}
