import './how-it-works.css'
import { PRESETS, displayForCommand } from '../../../src/keybindings'
import type { KeyPreset } from '../../../src/keybindings'

export function createHowItWorks(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'how-it-works'
  section.id = 'how-it-works'

  let activePreset: KeyPreset = 'homerow'

  function render(): void {
    const d = (cmd: string) => displayForCommand(activePreset, cmd)

    section.innerHTML = `
      <div class="container">
        <h2 class="section-heading" data-reveal>Three keystrokes. That's it.</h2>

        <div class="preset-toggle" data-reveal>
          <button class="preset-btn ${activePreset === 'homerow' ? 'preset-btn--active' : ''}" data-preset="homerow">
            ${PRESETS.homerow.label}
          </button>
          <button class="preset-btn ${activePreset === 'vim' ? 'preset-btn--active' : ''}" data-preset="vim">
            ${PRESETS.vim.label}
          </button>
        </div>
        <p class="preset-desc" data-reveal>${PRESETS[activePreset].description}</p>

        <div class="steps">
          <div class="step" data-reveal>
            <div class="step-num">1</div>
            <div class="step-key"><kbd>${d('activateHints')}</kbd></div>
            <h3>Activate hints</h3>
            <p>Every clickable element gets a two-letter label &mdash; links, buttons, inputs, all of it.</p>
          </div>
          <div class="step-connector" aria-hidden="true"></div>
          <div class="step" data-reveal>
            <div class="step-num">2</div>
            <div class="step-key"><kbd>S</kbd> <kbd>A</kbd></div>
            <h3>Type the label</h3>
            <p>See the letters on the link you want? Type them. That's the click.</p>
          </div>
          <div class="step-connector" aria-hidden="true"></div>
          <div class="step" data-reveal>
            <div class="step-num">3</div>
            <div class="step-key"><span class="step-check">&#10003;</span></div>
            <h3>Done</h3>
            <p>The link opens. Your hands never moved. Your wrist sends a thank-you card.</p>
          </div>
        </div>
        <p class="steps-aside" data-reveal>
          Every shortcut lives on your home row.
          <kbd>${d('scrollDown')}</kbd>/<kbd>${d('scrollUp')}</kbd> to scroll.
          <kbd>${d('goBack')}</kbd>/<kbd>${d('goForward')}</kbd> for history.
          <kbd>${d('scrollHalfPageDown')}</kbd>/<kbd>${d('scrollHalfPageUp')}</kbd> to jump.
          <kbd>${d('showHelp')}</kbd> for help. Your hands never leave position.
        </p>
      </div>
    `

    // Wire toggle buttons
    section.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset as KeyPreset
        if (preset === activePreset) return
        activePreset = preset
        render()
        // Re-trigger reveal for freshly rendered elements
        section.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('visible'))
      })
    })
  }

  render()
  return section
}
