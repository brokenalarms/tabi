import iconSvg from '../../mockups/icon-final.svg?raw'

let instanceCount = 0

/**
 * Returns the Tabi icon as an SVGElement.
 * Each call produces unique gradient IDs to avoid DOM collisions.
 */
export function createIcon(className?: string): SVGElement {
  const id = ++instanceCount
  const temp = document.createElement('span')
  temp.innerHTML = iconSvg
    .replace('id="bg"', `id="icon-bg-${id}"`)
    .replace('url(#bg)', `url(#icon-bg-${id})`)
  const svg = temp.querySelector('svg')!
  if (className) svg.classList.add(className)
  return svg
}

export { iconSvg }
