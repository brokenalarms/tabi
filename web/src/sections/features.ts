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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" rx="3" width="12" height="10"/><text x="9" y="10" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none">ab</text><path d="M20 5v6"/><circle cx="20" cy="14" r="2" fill="currentColor" stroke="none"/></svg>`,
    title: 'Click any link',
    premium: false,
    description:
      'Press <kbd data-cmd="activateHints"></kbd> and every clickable element gets a two-letter label you can type to click.',
  },
  {
    cat: 'scroll',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" rx="4" width="14" height="20"/><line x1="12" y1="7" x2="12" y2="17"/><polyline points="9,9 12,6 15,9"/><polyline points="9,15 12,18 15,15"/></svg>`,
    title: 'Scroll from home row',
    premium: false,
    description:
      'Smooth vim-style scrolling — line by line, half-page jumps, or straight to the top and bottom.',
  },
  {
    cat: 'tabs',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/><text x="11" y="13" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none">~</text></svg>`,
    title: 'Fuzzy tab search',
    premium: true,
    description:
      'Press <kbd data-cmd="openTabSearch"></kbd> and find any open tab instantly with fzf-style fuzzy matching.',
  },
  {
    cat: 'tabs',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 8,14"/><path d="M20 4l1.5-1.5M4 4L2.5 2.5"/></svg>`,
    title: 'Tab memory',
    premium: true,
    description:
      'Navigate back and forward through your tab history — like undo/redo, but for which tab you were on.',
  },
  {
    cat: 'actions',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" rx="2" width="8" height="7"/><rect x="14" y="3" rx="2" width="8" height="7"/><rect x="2" y="14" rx="2" width="8" height="7"/><rect x="14" y="14" rx="2" width="8" height="7" stroke-dasharray="3,2"/></svg>`,
    title: 'Batch open links',
    premium: true,
    description:
      'Select multiple links with <kbd data-cmd="multiOpen"></kbd>, then open them all in new tabs at once.',
  },
  {
    cat: 'marks',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a1 1 0 011 1v16.5l-8-5-8 5V4a1 1 0 011-1z"/><circle cx="12" cy="10" r="2.5" fill="currentColor" stroke="none"/></svg>`,
    title: 'Quick marks',
    premium: true,
    description:
      'Bookmark any tab with <kbd data-cmd="setMark"></kbd> and jump back to it instantly, even across sessions.',
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
