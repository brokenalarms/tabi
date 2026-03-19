import './backstory.css'

export function createBackstory(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'backstory'
  section.id = 'why-tabi'
  section.innerHTML = `
    <div class="container">
      <p class="section-badge" data-reveal>The backstory</p>
      <h2 class="section-heading" data-reveal>"Why not just use Vimium on Chrome?"</h2>
      <p class="backstory-subtitle" data-reveal>
        Great question. Short answer: I tried. I tried <em>everything</em>. Then I built this.
      </p>

      <div class="backstory-origin" data-reveal>
        <h3>I tried every keyboard extension so you don't have to</h3>
        <p>
          Vimium on Chrome. Vimari on Safari. Surfingkeys. Vimlike. Vimkey.
          I installed them all, used each one for weeks, and found them all
          frustrating in different ways. Some had janky scrolling. Some broke
          on half the websites I visited. Some hadn't been updated in years.
          Some looked like they were designed by someone who actively dislikes
          human eyes.
        </p>
        <p>
          So I did what any reasonable person would do: I built my own from scratch.
          Not a fork. Not a port. A clean implementation with the things I actually
          wanted &mdash; smooth scrolling, hints that don't look like ransom notes,
          tab search that actually works, and themes that don't make you wince.
        </p>
      </div>

      <div class="backstory-safari" data-reveal>
        <h3>And why Safari?</h3>
        <p class="backstory-safari-intro">
          Safari on a Mac isn't just a browser &mdash; it's the browser your Mac was designed to run.
          Touch ID for logins, iCloud tab sync across devices, native Apple Pay, auto-filled
          verification codes from Messages, and battery life Chrome can only dream about.
          The privacy model doesn't need to fund an advertising business.
        </p>
        <p class="backstory-safari-intro">
          Chrome is a great browser. But on a Mac, Safari gives you things Chrome literally
          can't &mdash; and with Tabi, the one thing it was missing (keyboard navigation)
          is now covered.
        </p>
      </div>

      <div class="backstory-rsi" data-reveal>
        <div class="backstory-rsi-text">
          <h3>Your wrist didn't sign up for this</h3>
          <p>
            Every time you reach for your mouse, your wrist does a tiny little cry.
            Mouse use is the #1 culprit for hand and wrist strain &mdash; linked to carpal
            tunnel syndrome, tendonitis, and De Quervain's tenosynovitis.
            The primary recommendation from ergonomics experts?
            <strong>Reduce unnecessary hand movements.</strong>
          </p>
          <p>
            Tabi eliminates the single most repetitive motion in your workday:
            the keyboard-to-mouse-and-back dance. Your hands stay in their
            natural home-row position.
          </p>
          <ul class="backstory-rsi-benefits">
            <li>Eliminates lateral wrist movement to and from mouse</li>
            <li>Keeps hands in neutral home-row position</li>
            <li>Reduces shoulder rotation and elbow deviation</li>
            <li>Removes fine-motor precision stress (no more pixel-hunting)</li>
            <li>Works with split keyboards, ergonomic setups, and wrist braces</li>
          </ul>
        </div>
        <div class="backstory-rsi-stats">
          <div class="backstory-stat-card">
            <div class="backstory-stat-num" data-count="1300">0</div>
            <div class="backstory-stat-label">Mouse reaches per hour<br />of web browsing</div>
          </div>
          <div class="backstory-stat-card backstory-stat-card--alt">
            <div class="backstory-stat-num" data-count="60" data-suffix="%">0</div>
            <div class="backstory-stat-label">Of computer workers report<br />upper extremity pain</div>
          </div>
        </div>
      </div>
    </div>
  `
  return section
}

export function initBackstoryCounters(): void {
  const els = document.querySelectorAll<HTMLElement>('[data-count]')

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        const target = parseInt(el.dataset.count ?? '0', 10)
        const suffix = el.dataset.suffix ?? '+'
        animateCount(el, target, suffix)
        observer.unobserve(entry.target)
      })
    },
    { threshold: 0.5 }
  )

  els.forEach((el) => observer.observe(el))
}

function animateCount(el: HTMLElement, target: number, suffix: string): void {
  const duration = 1200
  const start = performance.now()

  function tick(now: number): void {
    const progress = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    const current = Math.round(eased * target)
    el.textContent = current.toLocaleString() + (progress >= 1 ? suffix : '')
    if (progress < 1) requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}
