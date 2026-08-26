import { CameraPreview } from './features/camera/CameraPreview'

const roles = [
  {
    title: 'I am signing',
    description:
      'Use your camera to turn signed communication into confirmed captions and speech.',
  },
  {
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
            M
          </span>
          <span>My Turn</span>
        </a>

        <span className="privacy-label">
          <span className="privacy-dot" aria-hidden="true" />
          Private by design
        </span>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Accessible meeting communication</p>
            <h1 id="hero-title">
              Your signs.
              <span>Your voice.</span>
            </h1>
            <p className="hero-description">
              My Turn helps people communicate through live signing, clear
              captions, and natural voice during online meetings.
            </p>

            <div className="hero-actions">
              <a className="primary-action" href="#camera-workspace">
                Start signing
              </a>
              <a className="secondary-action" href="#how-it-works">
                How it works
              </a>
            </div>
          </div>

          <aside className="translation-preview" aria-label="Translation example">
            <div className="preview-header">
              <span>Live translation</span>
              <span className="confidence">94% confidence</span>
            </div>

            <blockquote>
              “Hello, my name is Abhinav. It is good to meet you.”
            </blockquote>

            <div className="preview-footer">
              <span>Signed communication</span>
              <span aria-hidden="true">→</span>
              <span>English voice</span>
            </div>
          </aside>
        </section>

        <CameraPreview />

        <section
          className="role-section"
          id="choose-role"
          aria-labelledby="role-title"
        >
          <p className="section-label">Choose your experience</p>
          <h2 id="role-title">How are you joining?</h2>

          <div className="role-grid">
            {roles.map((role, index) => (
              <article className="role-card" key={role.title}>
                <span className="role-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3>{role.title}</h3>
                <p>{role.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="process-section"
          id="how-it-works"
          aria-labelledby="process-title"
        >
          <p className="section-label">How it works</p>
          <h2 id="process-title">Human confirmation stays in control.</h2>

          <ol className="process-list">
            {steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer>
        <p>Built for communication without barriers.</p>
      </footer>
    </div>
  )
}

export default App
