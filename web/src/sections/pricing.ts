import './pricing.css'
import { displayForCommand } from '../../../src/keybindings'
import type { KeyLayout } from '../../../src/types'

export function createPricing(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'pricing'
  section.id = 'pricing'

  const preset: KeyLayout = 'optimized'
  const d = (cmd: string) => displayForCommand(preset, cmd)

  section.innerHTML = `
    <div class="container">
      <h2 class="section-heading" data-reveal>One price. No subscriptions.</h2>
      <p class="pricing-subtitle" data-reveal>Core keyboard navigation is free forever. Power features are a one-time purchase.</p>

      <div class="pricing-grid">
        <div class="pricing-card" data-reveal>
          <div class="pricing-tier">Free</div>
          <div class="pricing-price">$0</div>
          <div class="pricing-desc">Everything you need to ditch your mouse.</div>
          <ul class="pricing-features">
            <li><span class="pcheck">&check;</span> Link hints &mdash; <kbd>${d('activateHints')}</kbd> to label, type to click</li>
            <li><span class="pcheck">&check;</span> Scrolling &mdash; <kbd>${d('scrollDown')}</kbd>/<kbd>${d('scrollUp')}</kbd>, <kbd>${d('scrollHalfPageDown')}</kbd>/<kbd>${d('scrollHalfPageUp')}</kbd></li>
            <li><span class="pcheck">&check;</span> History &mdash; <kbd>${d('goBack')}</kbd>/<kbd>${d('goForward')}</kbd> back/forward</li>
            <li><span class="pcheck">&check;</span> Tab management &mdash; new, close, restore, reorder</li>
            <li><span class="pcheck">&check;</span> All themes &amp; keyboard layouts</li>
            <li><span class="pcheck">&check;</span> Site exclusions</li>
            <li><span class="pcheck">&check;</span> Privacy-first &mdash; zero data collected</li>
          </ul>
          <a href="#download" class="btn btn-outline">Download Free</a>
        </div>

        <div class="pricing-card pricing-card--pro" data-reveal>
          <div class="pricing-badge">Recommended</div>
          <div class="pricing-tier">Tabi Premium</div>
          <div class="pricing-price">$4.99 <span class="pricing-once">one-time</span></div>
          <div class="pricing-desc">For power users who want the full toolkit.</div>
          <ul class="pricing-features">
            <li class="pricing-includes">Everything in Free, plus:</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Fuzzy tab search &mdash; <kbd>${d('openTabSearch')}</kbd> to find any tab instantly</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Tab memory &mdash; <kbd>${d('tabHistoryBack')}</kbd>/<kbd>${d('tabHistoryForward')}</kbd> navigate your tab history</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Batch mode &mdash; <kbd>${d('multiOpen')}</kbd> to open multiple links at once</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Yank mode &mdash; <kbd>${d('yankLink')}</kbd> to copy any link URL</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Quick marks &mdash; <kbd>${d('setMark')}</kbd> for persistent tab bookmarks</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Usage statistics &mdash; track your keyboard savings</li>
          </ul>
          <a href="#download" class="btn btn-primary">Get Tabi Premium &mdash; $4.99</a>
        </div>
      </div>
    </div>
  `
  return section
}
