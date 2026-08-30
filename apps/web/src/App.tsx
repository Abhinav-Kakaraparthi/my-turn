import { CameraPreview } from './features/camera/CameraPreview'

const roles = [
  {
    eyebrow: 'Express',
    title: 'I am signing',
    description:
      'Use your camera to turn signed communication into confirmed captions and speech.',
  },
  {
    eyebrow: 'Understand',
    title: 'I am listening',
    description:
      'Join a shared room to receive live captions and spoken translations.',
  },
] as const

const steps = [
  'Capture signing with clear user consent.',
  'Confirm uncertain translations before sharing.',
  'Deliver captions and voice to the meeting room.',
] as const

function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="My Turn home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>My Turn</span>
        </a>

        <nav className="site-nav" aria-label="Primary navigation">
          <a href="#camera-workspace">Product</a>
          <a href="#choose-role">Use cases</a>
          <a href="#how-it-works">How it works</a>
        </nav>

        <a className="header-action" href="#camera-workspace">
          Open workspace
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span aria-hidden="true" />
              Real-time communication intelligence
            </p>
            <h1 id="hero-title">
              Sign naturally.
              <span>Be understood.</span>
            </h1>
            <p className="hero-description">
              My Turn transforms live signing into clear captions and natural
              voice—while keeping the signer in control of every uncertain
              translation.
            </p>

            <div className="hero-actions">
              <a className="primary-action" href="#camera-workspace">
                Launch live workspace
                <span aria-hidden="true">→</span>
              </a>
              <a className="secondary-action" href="#how-it-works">
                Explore the workflow
              </a>
            </div>

            <dl className="hero-proof" aria-label="Product capabilities">
              <div>
                <dt>250</dt>
                <dd>public signs</dd>
              </div>
              <div>
                <dt>Local</dt>
                <dd>visual perception</dd>
              </div>
              <div>
                <dt>Private</dt>
                <dd>personal memory</dd>
              </div>
            </dl>
          </div>

          <aside className="translation-preview" aria-label="Translation example">
            <div className="preview-header">
              <div className="preview-window-controls" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="preview-secure">
                <span aria-hidden="true" />
                Live · private
              </span>
            </div>

            <div className="preview-body">
              <div className="preview-source">
              <span className="preview-avatar" aria-hidden="true">
                A
              </span>
                <div>
                  <span>Abhinav is signing</span>
                  <div className="signal-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>

              <div className="preview-transcript">
                <span>Confirmed translation</span>
                <blockquote>
                  “Hello, my name is Abhinav. It is good to meet you.”
                </blockquote>
              </div>

              <div className="preview-confidence">
                <div>
                  <span>Recognition confidence</span>
                  <strong>94%</strong>
                </div>
                <span>
                  <i />
                </span>
              </div>
            </div>

            <div className="preview-footer">
              <span className="audio-icon" aria-hidden="true">
                ◖
              </span>
              <span>Voice ready</span>
              <span className="preview-play">Play output</span>
            </div>
          </aside>
        </section>

        <CameraPreview />

        <section
          className="role-section"
          id="choose-role"
          aria-labelledby="role-title"
        >
          <div className="section-intro">
            <div>
              <p className="section-label">One conversation, two experiences</p>
              <h2 id="role-title">Designed around the people in the room.</h2>
            </div>
            <p>
              A shared communication layer that respects how each participant
              naturally expresses and receives meaning.
            </p>
          </div>

          <div className="role-grid">
            {roles.map((role, index) => (
              <article className="role-card" key={role.title}>
                <div className="role-card-top">
                  <span className="role-number" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <span className="role-arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
                <div>
                  <p className="role-eyebrow">{role.eyebrow}</p>
                  <h3>{role.title}</h3>
                  <p>{role.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className="process-section"
          id="how-it-works"
          aria-labelledby="process-title"
        >
          <div className="section-intro">
            <div>
              <p className="section-label">How it works</p>
              <h2 id="process-title">Intelligence with a human checkpoint.</h2>
            </div>
            <p>
              Fast enough for live meetings, deliberate enough for language
              that deserves precision.
            </p>
          </div>

          <ol className="process-list">
            {steps.map((step, index) => (
              <li key={step}>
                <span>0{index + 1}</span>
                <p>{step}</p>
                <span aria-hidden="true">→</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer>
        <a className="brand footer-brand" href="/" aria-label="My Turn home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>My Turn</span>
        </a>
        <p>Communication without barriers.</p>
        <span>Private by design · 2026</span>
      </footer>
    </div>
  )
}

export default App
