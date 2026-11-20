import { createMediaQuery } from "@solid-primitives/media"
import { Show } from "solid-js"

export function SessionHeaderSpacer(props: { visible: boolean }) {
  const isDesktop = createMediaQuery("(min-width: 768px)")

  return (
    <Show when={isDesktop() && props.visible}>
      {/* The floating header row holds the side-dock toggle and the slot left of it: two large icon buttons and a gap. */}
      <div class="h-7 w-16 shrink-0" aria-hidden />
    </Show>
  )
}
