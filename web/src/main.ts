import './style.css'

// ============================================
// Tabi Keys — Interactive Demo & Animations
// ============================================

// --- Scroll-triggered fade-in animations ---
function initScrollAnimations(): void {
  const targets = document.querySelectorAll<HTMLElement>(
    '.pain-card, .step-card, .feature-card, .audience-card, .anatomy-step, .rsi-info-box, .pain-anatomy, .comparison-table-wrap'
  )
  targets.forEach((el) => el.classList.add('fade-in'))

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          ;(entry.target as HTMLElement).classList.add('visible')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.15 }
  )

  targets.forEach((el) => observer.observe(el))
}

// --- Animated stat counters ---
function initCounters(): void {
  const stats = document.querySelectorAll<HTMLElement>('[data-count]')

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        const target = parseInt(el.dataset.count ?? '0', 10)
        animateCount(el, target)
        observer.unobserve(el)
      })
    },
    { threshold: 0.5 }
  )

  stats.forEach((el) => observer.observe(el))
}

function animateCount(el: HTMLElement, target: number): void {
  const duration = 1500
  const start = performance.now()
  const suffix = el.closest('.pain-card')?.querySelector('.pain-label')?.textContent?.includes('%')
    ? ''
    : '+'

  function tick(now: number): void {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3)
    const current = Math.round(eased * target)
    el.textContent = current.toLocaleString() + (progress >= 1 ? suffix : '')
    if (progress < 1) requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

// --- Interactive Hint Demo ---
const HINT_CHARS = 'sadgjklewcmpoh'

interface HintState {
  active: boolean
  hints: Array<{ element: HTMLElement; label: string; hintEl: HTMLElement }>
  typed: string
}

const demoState: HintState = {
  active: false,
  hints: [],
  typed: '',
}

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

function showHints(): void {
  const container = document.getElementById('demo-content')
  const overlay = document.getElementById('demo-hints')
  const status = document.getElementById('demo-status')
  if (!container || !overlay || !status) return

  const targets = container.querySelectorAll<HTMLElement>('[data-hint-target]')
  const labels = generateLabels(targets.length)

  overlay.innerHTML = ''
  demoState.hints = []
  demoState.typed = ''
  demoState.active = true

  const containerRect = container.getBoundingClientRect()

  targets.forEach((el, i) => {
    const rect = el.getBoundingClientRect()
    const hintEl = document.createElement('div')
    hintEl.className = 'demo-hint'
    hintEl.textContent = labels[i].toUpperCase()
    hintEl.style.top = `${rect.top - containerRect.top + rect.height / 2 - 10}px`
    hintEl.style.left = `${rect.left - containerRect.left - 2}px`
    overlay.appendChild(hintEl)
    demoState.hints.push({ element: el, label: labels[i], hintEl })
  })

  status.innerHTML = 'Hints active! Type a two-letter combo (e.g. <kbd>S</kbd> <kbd>A</kbd>) to click'
}

function hideHints(): void {
  const overlay = document.getElementById('demo-hints')
  const status = document.getElementById('demo-status')
  if (overlay) overlay.innerHTML = ''
  if (status) status.innerHTML = 'Press <kbd>F</kbd> to activate hints'
  demoState.active = false
  demoState.hints = []
  demoState.typed = ''
}

function handleDemoKey(e: KeyboardEvent): void {
  const content = document.getElementById('demo-content')
  if (!content || document.activeElement !== content) return

  e.preventDefault()

  const key = e.key.toLowerCase()

  // Escape to cancel
  if (key === 'escape') {
    hideHints()
    return
  }

  // F to activate
  if (!demoState.active && key === 'f') {
    showHints()
    return
  }

  if (!demoState.active) return

  // Only accept hint chars
  if (!HINT_CHARS.includes(key)) return

  demoState.typed += key

  // Update hint display — dim matched first chars, highlight matching
  demoState.hints.forEach(({ label, hintEl }) => {
    if (demoState.typed.length === 1) {
      if (label.startsWith(demoState.typed)) {
        hintEl.innerHTML = `<span class="hint-dim">${label[0].toUpperCase()}</span>${label[1].toUpperCase()}`
      } else {
        hintEl.style.opacity = '0.15'
      }
    }
  })

  // Check for match on two chars typed
  if (demoState.typed.length >= 2) {
    const match = demoState.hints.find((h) => h.label === demoState.typed)
    if (match) {
      // Flash the matched element
      match.hintEl.classList.add('matched')
      match.element.classList.add('hint-clicked')

      const status = document.getElementById('demo-status')
      const targetText = match.element.textContent?.trim() ?? 'link'
      if (status) {
        status.innerHTML = `Clicked "<strong>${targetText}</strong>"! Press <kbd>F</kbd> to try again.`
      }

      setTimeout(() => {
        match.element.classList.remove('hint-clicked')
        hideHints()
      }, 600)
    } else {
      // No match — reset
      hideHints()
      const status = document.getElementById('demo-status')
      if (status) {
        status.innerHTML = 'No match. Press <kbd>F</kbd> to try again.'
      }
    }
  }
}

function initDemo(): void {
  document.addEventListener('keydown', handleDemoKey)

  // Focus hint on click
  const content = document.getElementById('demo-content')
  if (content) {
    content.addEventListener('click', () => content.focus())
  }
}

// --- Mobile nav toggle ---
function initMobileNav(): void {
  const toggle = document.getElementById('nav-toggle')
  const links = document.querySelector('.nav-links')
  if (!toggle || !links) return

  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('nav-links-open')
    if (isOpen) {
      ;(links as HTMLElement).style.display = 'flex'
    } else {
      ;(links as HTMLElement).style.display = ''
    }
  })
}

// --- Smooth scroll for nav links ---
function initSmoothScroll(): void {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href')
      if (!href || href === '#') return
      const target = document.querySelector(href)
      if (target) {
        e.preventDefault()
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations()
  initCounters()
  initDemo()
  initMobileNav()
  initSmoothScroll()
})
