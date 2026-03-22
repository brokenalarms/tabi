import './hero.css'
import { createIcon } from '../icon.ts'

export function createHero(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'hero'
  section.id = 'hero'
  section.innerHTML = `
    <div class="container hero-inner">
      <div class="hero-mascot-wrap" aria-hidden="true">
        <div class="hero-mascot-slot"></div>
      </div>
      <div class="hero-wordmark">Tabi</div>
      <p class="hero-eyebrow">Safari extension for macOS</p>
      <h1 class="hero-title">Click any link.<br>Type two letters.</h1>
      <p class="hero-subtitle">
        Tabi puts every clickable element at your fingertips.
        Press one key, type two letters, done.
        Your hands never leave the keyboard.
      </p>
      <div class="hero-cta-row">
        <a href="#pricing" class="btn btn-primary">Get Tabi Premium &mdash; $4.99</a>
        <a href="#demo" class="btn btn-ghost">Try the demo</a>
      </div>
      <div class="hero-steps">
        <div class="hero-step">
          <div class="hero-step-num">1</div>
          <kbd class="hero-kbd hero-kbd--trigger">F</kbd>
          <div class="hero-mini-preview">
            <div class="hero-mini-link"><span class="hero-mini-hint">SA</span> Shop All</div>
            <div class="hero-mini-link"><span class="hero-mini-hint">DG</span> Build Guides</div>
            <div class="hero-mini-link"><span class="hero-mini-hint">JK</span> Route Maps</div>
          </div>
          <div class="hero-step-label">Every link gets a label</div>
        </div>
        <div class="hero-step-arrow">&rarr;</div>
        <div class="hero-step">
          <div class="hero-step-num">2</div>
          <div class="hero-step-keys"><kbd class="hero-kbd">S</kbd> <kbd class="hero-kbd">A</kbd></div>
          <div class="hero-mini-preview hero-mini-preview--typed">
            <div class="hero-mini-link hero-mini-match"><span class="hero-mini-hint"><span class="hero-hint-dim">S</span>A</span> Shop All</div>
            <div class="hero-mini-link"><span class="hero-mini-hint">DG</span> Build Guides</div>
            <div class="hero-mini-link"><span class="hero-mini-hint">JK</span> Route Maps</div>
          </div>
          <div class="hero-step-label">Type the letters &mdash; that&rsquo;s the click</div>
        </div>
        <div class="hero-step-arrow">&rarr;</div>
        <div class="hero-step">
          <div class="hero-step-num">3</div>
          <div class="hero-result-page">
            <div class="hero-result-toolbar">
              <div class="hero-result-dot"></div>
              <div class="hero-result-dot"></div>
              <div class="hero-result-dot"></div>
              <div class="hero-result-url">/shop-all</div>
            </div>
            <div class="hero-result-body">
              <h4>Shop All</h4>
              <p>Bikepacking gear for the long way round.</p>
              <div class="hero-result-items">
                <div class="hero-result-item">
                  <div class="hero-result-item-img"></div>
                  <span>Framebags</span>
                </div>
                <div class="hero-result-item">
                  <div class="hero-result-item-img hero-result-item-img--alt"></div>
                  <span>Lighting</span>
                </div>
              </div>
            </div>
            <div class="hero-mascot-float-slot"></div>
          </div>
          <div class="hero-step-label">You&rsquo;ve tabbied &#10024;</div>
        </div>
      </div>
    </div>
  `

  const mascotSlot = section.querySelector('.hero-mascot-slot')!
  const mascotIcon = createIcon('hero-mascot-svg')
  mascotSlot.appendChild(mascotIcon)

  const floatSlot = section.querySelector('.hero-mascot-float-slot')!
  const floatIcon = createIcon('hero-float-svg')
  floatSlot.appendChild(floatIcon)

  return section
}
