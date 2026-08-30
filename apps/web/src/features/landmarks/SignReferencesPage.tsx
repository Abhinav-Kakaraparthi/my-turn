import { useEffect, useMemo, useState } from 'react'
import {
  loadPracticeCatalog,
  type PracticeCatalog,
} from './practiceCatalog'
import { SignReferencePlayer } from './SignReferencePlayer'
import './SignReferencesPage.css'

export function SignReferencesPage() {
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedSign, setSelectedSign] = useState('hello')

  useEffect(() => {
    let mounted = true

    void loadPracticeCatalog()
      .then((nextCatalog) => {
        if (mounted) {
          setCatalog(nextCatalog)
          setErrorMessage(null)
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'The sign reference catalog could not be loaded.',
          )
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  const filteredReferences = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!catalog) {
      return []
    }

    return normalizedQuery
      ? catalog.references.filter((reference) =>
          reference.sign.includes(normalizedQuery),
        )
      : catalog.references
  }, [catalog, query])

  return (
    <div className="app-shell sign-references-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="My Turn home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>My Turn</span>
        </a>

        <nav className="site-nav" aria-label="Primary navigation">
          <a href="/#camera-workspace">Live workspace</a>
          <a href="/sign-references" aria-current="page">
            Sign references
          </a>
          <a href="/#how-it-works">How it works</a>
        </nav>

        <a className="header-action" href="/#camera-workspace">
          Open workspace
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main className="sign-references-main">
        <section className="sign-references-intro">
          <p className="eyebrow">
            <span aria-hidden="true" />
            250 model-aligned demonstrations
          </p>
          <h1>
            See the motion.
            <span>Then make it yours.</span>
          </h1>
          <p>
            Search the public recognition vocabulary and play a mirrored
            landmark demonstration before practicing with your camera.
          </p>
        </section>

        <section
          className="sign-reference-workspace"
          aria-labelledby="sign-reference-list-title"
        >
          <aside className="sign-reference-browser">
            <div className="sign-reference-browser-heading">
              <div>
                <p className="section-label">Reference library</p>
                <h2 id="sign-reference-list-title">All signs</h2>
              </div>
              <span>{filteredReferences.length}/250</span>
            </div>

            <label className="sign-reference-search">
              <span>Search signs</span>
              <input
                type="search"
                value={query}
                placeholder="Try hello, dad, water…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {!catalog && !errorMessage && (
              <p className="sign-reference-message" role="status">
                Loading the reference catalog…
              </p>
            )}

            {errorMessage && (
              <p className="sign-reference-error" role="alert">
                {errorMessage}
              </p>
            )}

            {catalog && filteredReferences.length === 0 && (
              <p className="sign-reference-message">
                No signs match “{query}”.
              </p>
            )}

            <div className="sign-reference-grid">
              {filteredReferences.map((reference) => (
                <button
                  type="button"
                  key={reference.sign}
                  data-selected={reference.sign === selectedSign}
                  aria-pressed={reference.sign === selectedSign}
                  onClick={() => setSelectedSign(reference.sign)}
                >
                  <span>{reference.sign}</span>
                  <span aria-hidden="true">▶</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="sign-reference-stage">
            <SignReferencePlayer sign={selectedSign} />

            <a
              className="sign-reference-practice-link"
              href="/#camera-workspace"
            >
              Practice {selectedSign} with your camera
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section className="sign-reference-disclosure">
          <div>
            <p className="section-label">Source and scope</p>
            <h2>Reference data, not language instruction.</h2>
          </div>
          <div>
            <p>
              These animations are derived from MediaPipe landmarks in the
              Google–PopSign isolated-sign dataset. They contain no source
              video and are loaded only when you select a sign.
            </p>
            <p>
              Isolated examples do not capture the full grammar, regional
              variation, facial expression, or conversational context of ASL.
              Use them as model-aligned practice aids—not as a replacement for
              a qualified Deaf ASL educator.
            </p>
            {catalog && (
              <a
                href={catalog.source.url}
                target="_blank"
                rel="noreferrer"
              >
                View dataset source and terms ↗
              </a>
            )}
          </div>
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
