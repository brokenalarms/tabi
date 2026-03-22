import './why-safari.css'

interface SafariCard {
  emoji: string
  title: string
  description: string
}

const CARDS: SafariCard[] = [
  {
    emoji: '\uD83D\uDCF2',
    title: 'OTP from your phone',
    description:
      'One-time passwords appear automatically from your iPhone — no copying, no switching apps.',
  },
  {
    emoji: '\uD83D\uDD10',
    title: 'Touch ID & Passkeys',
    description:
      'Log in with a fingerprint instead of typing passwords.',
  },
  {
    emoji: '\uD83D\uDCF1',
    title: 'iCloud tab sync',
    description:
      'Your tabs follow you across Mac, iPhone, and iPad — pick up exactly where you left off.',
  },
  {
    emoji: '\uD83D\uDCB3',
    title: 'Apple Pay',
    description:
      'One-click checkout on the web, no extensions or card numbers needed.',
  },
  {
    emoji: '\uD83D\uDD0B',
    title: 'Battery life',
    description:
      'Safari sips power where Chrome gulps it — hours more on a single charge.',
  },
  {
    emoji: '\u2328\uFE0F',
    title: 'Now with Tabi',
    description:
      'The one thing Safari was missing — full keyboard navigation — is now covered.',
  },
]

export function createWhySafari(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'why-safari'
  section.id = 'why-safari'

  const cardsHtml = CARDS.map(
    (c) => `
      <div class="ws-card" data-reveal>
        <div class="ws-emoji">${c.emoji}</div>
        <h3>${c.title}</h3>
        <p>${c.description}</p>
      </div>`
  ).join('')

  section.innerHTML = `
    <div class="container">
      <p class="section-badge" data-reveal>Why Safari?</p>
      <h2 class="section-heading" data-reveal>Your Mac\u2019s best-kept secret.</h2>
      <div class="ws-grid">${cardsHtml}</div>
    </div>
  `
  return section
}
