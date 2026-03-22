import './features.css'
import { displayForCommand } from '../../../src/keybindings'
import type { KeyLayout } from '../../../src/types'

interface FeatureCard {
  cat: string
  icon: string
  title: string
  premium: boolean
  description: string
}

const FEATURES: FeatureCard[] = [
  {
    cat: 'hints',
    icon: '⎆',
    title: 'Click any link',
    premium: false,
    description:
      'Press <kbd data-cmd="activateHints"></kbd> and every clickable element gets a label. Type two letters to click. Hold Shift to open in a new tab.',
  },
  {
    cat: 'scroll',
    icon: '⇕',
    title: 'Scroll from home row',
    premium: false,
    description:
      '<kbd data-cmd="scrollDown"></kbd>/<kbd data-cmd="scrollUp"></kbd> to scroll. <kbd data-cmd="scrollHalfPageDown"></kbd>/<kbd data-cmd="scrollHalfPageUp"></kbd> to jump half a page. Top and bottom in one keystroke.',
  },
  {
    cat: 'tabs',
    icon: '⊞',
    title: 'Fuzzy tab search',
    premium: true,
    description:
      '<kbd data-cmd="openTabSearch"></kbd> to search open tabs by title or URL. fzf-style fuzzy matching finds the tab you want instantly.',
  },
  {
    cat: 'tabs',
    icon: '⟲',
    title: 'Tab memory',
    premium: true,
    description:
      'Navigate back and forward through your tab history. <kbd data-cmd="tabHistoryBack"></kbd>/<kbd data-cmd="tabHistoryForward"></kbd> \u2014 like browser back/forward, but for tabs.',
  },
  {
    cat: 'actions',
    icon: '⊕',
    title: 'Batch open links',
    premium: true,
    description:
      '<kbd data-cmd="multiOpen"></kbd> to enter batch mode. Select multiple links, then open them all in new tabs at once.',
  },
  {
    cat: 'marks',
    icon: '⚑',
    title: 'Quick marks',
    premium: true,
    description:
      '<kbd data-cmd="setMark"></kbd> to bookmark any tab with a label. Jump back instantly. Persists across sessions.',
  },
]

function resolveKbd(html: string, preset: KeyLayout): string {
  return html.replace(/<kbd data-cmd="(\w+)"><\/kbd>/g, (_match, cmd: string) => {
    const display = displayForCommand(preset, cmd)
    return `<kbd>${display}</kbd>`
  })
}

export function createFeatures(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'features'
  section.id = 'features'

  const preset: KeyLayout = 'optimized'

  const cardsHtml = FEATURES.map((f) => {
    const premiumBadge = f.premium ? '<span class="premium-badge">Premium</span>' : ''
    const description = resolveKbd(f.description, preset)

    return `
        <div class="feature-card" data-cat="${f.cat}" data-reveal>
          <div class="feature-icon-wrap">${f.icon}</div>
          <h3>${f.title}${premiumBadge}</h3>
          <p>${description}</p>
        </div>`
  }).join('')

  section.innerHTML = `
    <div class="container">
      <p class="section-badge" data-reveal>More than just hints</p>
      <h2 class="section-heading" data-reveal>Full keyboard control.<br>Every page. Every action.</h2>
      <div class="features-grid">${cardsHtml}</div>
    </div>
  `
  return section
}
