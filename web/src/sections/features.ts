import './features.css'

export function createFeatures(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'features'
  section.id = 'features'
  section.innerHTML = `
    <div class="container">
      <p class="section-badge" data-reveal>More than just hints</p>
      <h2 class="section-heading" data-reveal>Everything your keyboard can do<br />(that your mouse wishes it could)</h2>

      <div class="features-grid">
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#182;</div>
          <h3>Click any link</h3>
          <p>
            Press <kbd>F</kbd> and every clickable element gets a label. Type it to click.
            <kbd>Shift</kbd>+<kbd>F</kbd> opens in a new tab. Two keystrokes, any link, anywhere.
          </p>
        </div>
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#8597;</div>
          <h3>Navigate without reaching</h3>
          <p>
            Scroll with <kbd>J</kbd>/<kbd>K</kbd>. Jump half a page with <kbd>D</kbd>/<kbd>U</kbd>.
            Go back with <kbd>H</kbd>, forward with <kbd>L</kbd>. Every action is a keystroke
            from home row &mdash; your hands never leave position.
          </p>
        </div>
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#9733;</div>
          <h3>Manage tabs</h3>
          <p>
            <kbd>T</kbd> to search your open tabs by title. <kbd>t</kbd> for new tab,
            <kbd>x</kbd> to close, <kbd>X</kbd> to restore. Reorder with <kbd>Shift</kbd>+<kbd>J</kbd>/<kbd>K</kbd>.
            Jump to any tab with <kbd>g1</kbd>&ndash;<kbd>g9</kbd>.
          </p>
        </div>
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#8853;</div>
          <h3>Privacy first</h3>
          <p>
            No analytics. No tracking. No accounts. No servers. Your browsing stays
            between you and Safari. We literally can't see what you do.
          </p>
        </div>
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#9788;</div>
          <h3>Themes that adapt</h3>
          <p>
            Classic, dark, light, or Auto mode that reads the page background and adapts.
            Your hints always look like they belong.
          </p>
        </div>
        <div class="feature-card" data-reveal>
          <div class="feature-icon">&#8801;</div>
          <h3>Any keyboard layout</h3>
          <p>
            QWERTY, Dvorak, Colemak, AZERTY &mdash; all supported. Position-based or
            character-based mapping. Your layout, your rules.
          </p>
        </div>
      </div>
    </div>
  `
  return section
}
