import './demo.css'

const HINT_CHARS = 'sadgjklewcmpoh'

interface HintEntry {
  element: HTMLElement
  label: string
  hintEl: HTMLElement
}

interface DemoState {
  active: boolean
  hints: HintEntry[]
  typed: string
}

const state: DemoState = { active: false, hints: [], typed: '' }

function generateLabels(count: number): string[] {
  const labels: string[] = []
  const chars = HINT_CHARS.split('')
  for (let i = 0; i < count; i++) {
    const first = chars[Math.floor(i / chars.length) % chars.length]
    const second = chars[i % chars.length]
    labels.push(first + second)
  }
  return labels
}

function showHints(container: HTMLElement, overlay: HTMLElement, status: HTMLElement): void {
  const targets = container.querySelectorAll<HTMLElement>('[data-hint-target]')
  const labels = generateLabels(targets.length)

  overlay.innerHTML = ''
  state.hints = []
  state.typed = ''
  state.active = true

  const containerRect = container.getBoundingClientRect()

  targets.forEach((el, i) => {
    const rect = el.getBoundingClientRect()
    const hintEl = document.createElement('div')
    hintEl.className = 'demo-hint'
    hintEl.textContent = labels[i].toUpperCase()
    hintEl.style.top = `${rect.top - containerRect.top + rect.height / 2 - 10}px`
    hintEl.style.left = `${rect.left - containerRect.left - 2}px`
    overlay.appendChild(hintEl)
    state.hints.push({ element: el, label: labels[i], hintEl })
  })

  status.innerHTML = 'Hints active \u2014 type a two-letter combo to click'
}

function hideHints(overlay: HTMLElement, status: HTMLElement): void {
  overlay.innerHTML = ''
  status.innerHTML = 'Press <kbd>F</kbd> to activate hints'
  state.active = false
  state.hints = []
  state.typed = ''
}

export function createDemo(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'demo-section'
  section.id = 'demo'
  section.innerHTML = `
    <div class="container">
      <h2 class="section-heading" data-reveal>Try it. Right here.</h2>
      <p class="demo-intro" data-reveal>
        Click inside the browser below to focus it, then press <kbd>F</kbd> to see hints.
        Type a two-letter combo to &ldquo;click&rdquo; a link.
      </p>

      <div class="demo-browser" data-reveal>
        <div class="demo-toolbar">
          <div class="demo-dots">
            <span class="dot dot-close"></span>
            <span class="dot dot-min"></span>
            <span class="dot dot-max"></span>
          </div>
          <div class="demo-url-bar">
            <span>https://brokenalarmsbikes.com</span>
          </div>
        </div>
        <div class="demo-content" id="demo-content" tabindex="0">
          <div class="demo-hint-overlay" id="demo-hints"></div>
          <div class="fake-page">
            <div class="fake-header">
              <div class="fake-logo">\uD83D\uDEB2 Broken Alarms Bikes</div>
              <div class="fake-nav">
                <a class="fake-link" data-hint-target>Shop</a>
                <a class="fake-link" data-hint-target>Builds</a>
                <a class="fake-link" data-hint-target>Routes</a>
                <a class="fake-link" data-hint-target>Journal</a>
                <a class="fake-link" data-hint-target>About</a>
              </div>
            </div>
            <div class="fake-hero-area">
              <h2>Bikepacking gear for the long way round</h2>
              <p>Handpicked components for riders who&rsquo;d rather sleep under the stars.</p>
              <div class="fake-hero-buttons">
                <a class="fake-button" data-hint-target>Shop All</a>
                <a class="fake-button fake-button-outline" data-hint-target>Build Guides</a>
              </div>
            </div>
            <div class="fake-cards">
              <div class="fake-card">
                <div class="fake-card-img fake-card-img--green"></div>
                <h4>Framebags</h4>
                <p>Custom-fit bags for every frame geometry.</p>
                <a class="fake-link" data-hint-target>Browse &rarr;</a>
              </div>
              <div class="fake-card">
                <div class="fake-card-img fake-card-img--red"></div>
                <h4>Dynamo Lighting</h4>
                <p>Ride all night. Charge on the move.</p>
                <a class="fake-link" data-hint-target>Browse &rarr;</a>
              </div>
              <div class="fake-card">
                <div class="fake-card-img fake-card-img--blue"></div>
                <h4>Route Guides</h4>
                <p>GPX files for classics and hidden gems.</p>
                <a class="fake-link" data-hint-target>Browse &rarr;</a>
              </div>
            </div>
            <div class="fake-footer-bar">
              <a class="fake-link" data-hint-target>Shipping</a>
              <a class="fake-link" data-hint-target>Returns</a>
              <a class="fake-link" data-hint-target>Contact</a>
              <a class="fake-link" data-hint-target>Instagram</a>
            </div>
          </div>
          <div class="demo-status" id="demo-status">
            Click here, then press <kbd>F</kbd> to activate hints
          </div>
        </div>
      </div>
      <p class="demo-footnote" data-reveal>
        This is a simulation &mdash; the real extension works on every website in Safari.
      </p>
    </div>
  `

  requestAnimationFrame(() => {
    const content = document.getElementById('demo-content')
    const overlay = document.getElementById('demo-hints')
    const status = document.getElementById('demo-status')
    if (!content || !overlay || !status) return

    content.addEventListener('click', () => content.focus())

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement !== content) return
      e.preventDefault()
      const key = e.key.toLowerCase()

      if (key === 'escape') {
        hideHints(overlay, status)
        return
      }

      if (!state.active && key === 'f') {
        showHints(content, overlay, status)
        return
      }

      if (!state.active || !HINT_CHARS.includes(key)) return

      state.typed += key

      state.hints.forEach(({ label, hintEl }) => {
        if (state.typed.length === 1) {
          if (label.startsWith(state.typed)) {
            hintEl.innerHTML =
              `<span class="hint-dim">${label[0].toUpperCase()}</span>${label[1].toUpperCase()}`
          } else {
            hintEl.style.opacity = '0.15'
          }
        }
      })

      if (state.typed.length >= 2) {
        const match = state.hints.find((h) => h.label === state.typed)
        if (match) {
          match.hintEl.classList.add('matched')
          match.element.classList.add('hint-clicked')
          const targetText = match.element.textContent?.trim() ?? 'link'
          status.innerHTML = `Clicked \u201c<strong>${targetText}</strong>\u201d \u2014 press <kbd>F</kbd> to try again`
          const el = match.element
          const ov = overlay
          const st = status
          requestAnimationFrame(() => {
            el.addEventListener(
              'animationend',
              () => {
                el.classList.remove('hint-clicked')
                hideHints(ov, st)
                st.innerHTML = `Clicked \u201c<strong>${targetText}</strong>\u201d \u2014 press <kbd>F</kbd> to try again`
              },
              { once: true }
            )
          })
        } else {
          hideHints(overlay, status)
          status.innerHTML = 'No match \u2014 press <kbd>F</kbd> to try again'
        }
      }
    })
  })

  return section
}
