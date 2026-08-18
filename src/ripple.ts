// Material "ripple" touch feedback. Attach to any element with the `ripple-host` class
// (position:relative + overflow:hidden, set in styles.css) to get a circle that expands
// from the pointer position and fades — the signature Material interaction.

export function attachRipple(el: HTMLElement): void {
  el.addEventListener("pointerdown", (e) => {
    if (el.hasAttribute("disabled")) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Radius reaching the farthest corner from the pointer, so the ripple fully
    // covers the element by the time its scale animation completes.
    const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
    const diameter = radius * 2;

    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = `${diameter}px`;
    span.style.height = `${diameter}px`;
    span.style.left = `${x - radius}px`;
    span.style.top = `${y - radius}px`;
    el.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
  });
}

export function attachRippleAll(selector: string, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(selector).forEach(attachRipple);
}
