import './hero.css'
import { createIcon } from '../icon.ts'

export function createHero(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'hero'
  section.id = 'hero'
  section.innerHTML = `
    <div class="container hero-inner">
      <div class="hero-icon" aria-hidden="true"></div>
      <p class="hero-eyebrow">Safari extension for macOS</p>
      <h1 class="hero-title">
        Click any link.<br />Type two letters.
      </h1>
      <p class="hero-subtitle">
        Tabi puts every clickable element on the page at your fingertips.
        Press one key, type two letters, done.
        Your hands never leave the keyboard.
      </p>
      <div class="hero-cta-row">
        <a href="#download" class="btn btn-primary">Get Tabi &mdash; $4.99</a>
        <a href="#demo" class="btn btn-ghost">Try the demo</a>
      </div>
      <div class="hero-sequence" aria-hidden="true">
        <kbd class="hero-kbd hero-kbd--trigger">F</kbd>
        <span class="hero-arrow">&rarr;</span>
        <kbd class="hero-kbd">S</kbd>
        <kbd class="hero-kbd">A</kbd>
        <span class="hero-arrow">&rarr;</span>
        <span class="hero-result">clicked</span>
      </div>
    </div>
  `

  const iconSlot = section.querySelector('.hero-icon')!
  const icon = createIcon('hero-icon-svg')
  iconSlot.appendChild(icon)

  return section
}
