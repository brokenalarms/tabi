import './pricing.css'

export function createPricing(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'pricing'
  section.id = 'pricing'
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
            <li><span class="pcheck">&check;</span> Link hints &mdash; <kbd>F</kbd> to label, type to click</li>
            <li><span class="pcheck">&check;</span> Open in new tab &mdash; <kbd>Shift</kbd>+<kbd>F</kbd></li>
            <li><span class="pcheck">&check;</span> Scrolling &mdash; <kbd>J</kbd>/<kbd>K</kbd>, <kbd>D</kbd>/<kbd>U</kbd>, <kbd>G</kbd>/<kbd>gg</kbd></li>
            <li><span class="pcheck">&check;</span> History &mdash; <kbd>H</kbd>/<kbd>L</kbd> back/forward</li>
            <li><span class="pcheck">&check;</span> Tab management &mdash; new, close, restore, reorder</li>
            <li><span class="pcheck">&check;</span> All themes &amp; keyboard layouts</li>
            <li><span class="pcheck">&check;</span> Site exclusions</li>
            <li><span class="pcheck">&check;</span> Privacy-first &mdash; zero data collected</li>
          </ul>
          <a href="#download" class="btn btn-outline">Download Free</a>
        </div>

        <div class="pricing-card pricing-card--pro" data-reveal>
          <div class="pricing-badge">Recommended</div>
          <div class="pricing-tier">Tabi Pro</div>
          <div class="pricing-price">$4.99 <span class="pricing-once">one-time</span></div>
          <div class="pricing-desc">For power users who want the full toolkit.</div>
          <ul class="pricing-features">
            <li class="pricing-includes">Everything in Free, plus:</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Tab search &mdash; <kbd>T</kbd> to find any open tab</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Multi-hint mode &mdash; <kbd>M</kbd> to select multiple links</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Yank mode &mdash; <kbd>Y</kbd> to copy any link URL</li>
            <li><span class="pcheck pcheck--pro">&check;</span> Usage statistics &mdash; track your keyboard savings</li>
          </ul>
          <a href="#download" class="btn btn-primary">Get Tabi Pro &mdash; $4.99</a>
        </div>
      </div>
    </div>
  `
  return section
}
