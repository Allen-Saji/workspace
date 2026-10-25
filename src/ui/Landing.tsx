import Image from "next/image";
import Link from "next/link";
import Brand from "./Brand";
import GoogleSignInButton from "./GoogleSignInButton";
import { Icon } from "./Icon";
import styles from "./Landing.module.css";

function Arrow() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}
function StartLink({
  children = "Get started",
}: {
  children?: React.ReactNode;
}) {
  return (
    <Link href="/login" className={styles.start}>
      {children}
      <Arrow />
    </Link>
  );
}
function ExampleWorkspace() {
  return (
    <figure className={styles.preview} id="preview">
      <figcaption>
        Example workspace{" "}
        <span>A little structure for whatever comes next.</span>
      </figcaption>
      <div className={styles.previewFrame}>
        <div className={styles.previewSidebar} aria-hidden="true">
          <div className={styles.previewBrand}>
            <Image src="/icon.svg" alt="" width={26} height={26} />
            Workspace
          </div>
          {["Today", "Learning", "Agents", "Context"].map((label, index) => (
            <div
              key={label}
              className={index === 0 ? styles.previewSelected : ""}
            >
              <Icon name={label.toLowerCase()} />
              {label}
            </div>
          ))}
        </div>
        <div className={styles.previewMain}>
          <header>
            <h3>Good morning!</h3>
            <p>Your plans, with room to grow.</p>
          </header>
          <div className={styles.previewGrid}>
            <section>
              <h4>
                <Icon name="today" />
                Today
              </h4>
              <ul className={styles.exampleTasks}>
                <li>
                  <span className={styles.checked} aria-hidden="true">
                    &#10003;
                  </span>
                  <span>Review project notes</span>
                </li>
                <li>
                  <span aria-hidden="true" />
                  Plan the next release
                </li>
                <li>
                  <span aria-hidden="true" />
                  Read one chapter
                </li>
              </ul>
            </section>
            <section>
              <h4>
                <Icon name="note" />
                Notes
              </h4>
              <strong>Ideas for next week</strong>
              <p>
                Explore a new feature, refine the design, and list open
                questions.
              </p>
            </section>
            <section>
              <h4>
                <Icon name="learning" />
                Learning
              </h4>
              <strong>Build a reusable component</strong>
              <p>Practice in progress</p>
              <span className={styles.exampleProgress} aria-hidden="true">
                <i />
              </span>
            </section>
            <section>
              <h4>
                <Icon name="agents" />
                Agent updates
              </h4>
              <strong>Report received</strong>
              <p>A project summary, ready for you to review.</p>
            </section>
          </div>
        </div>
      </div>
    </figure>
  );
}
export default function Landing() {
  return (
    <div className={styles.landing}>
      <a className="skip" href="#landing-main">
        Skip to content
      </a>
      <header className={styles.navbar}>
        <Brand />
        <nav aria-label="Site navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className={styles.navActions}>
          <Link href="/login" className={styles.signIn}>
            Sign in
          </Link>
          <StartLink />
        </div>
      </header>
      <main id="landing-main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <Image
            src="/landing/floating-world.png"
            alt=""
            fill
            sizes="100vw"
            preload
            className={styles.heroArt}
          />
          <div className={styles.heroCopy}>
            <h1 id="hero-title">
              A place for
              <br />
              <span>your plans.</span>
            </h1>
            <p>
              Tasks, notes, learning, and agent updates
              <br className={styles.desktopBreak} /> in one personal workspace.
            </p>
            <div className={styles.heroActions}>
              <GoogleSignInButton />
              <a className={styles.explore} href="#preview">
                Take a look
                <Arrow />
              </a>
            </div>
          </div>
        </section>
        <section
          className={styles.features}
          id="features"
          aria-label="What you can do in Workspace"
        >
          <article>
            <span className={styles.featureIcon}>
              <Icon name="today" />
            </span>
            <div>
              <h2>Plan your day</h2>
              <p>Keep tasks, meetings, and notes together.</p>
            </div>
          </article>
          <article>
            <span className={`${styles.featureIcon} ${styles.mint}`}>
              <Icon name="learning" />
            </span>
            <div>
              <h2>Keep learning</h2>
              <p>Track the skills you are practicing.</p>
            </div>
          </article>
          <article>
            <span className={`${styles.featureIcon} ${styles.yellow}`}>
              <Icon name="context" />
            </span>
            <div>
              <h2>Keep the context</h2>
              <p>Review decisions and reports from your agents.</p>
            </div>
          </article>
        </section>
        <div className={styles.previewWrap}>
          <ExampleWorkspace />
        </div>
        <section
          className={styles.steps}
          id="how-it-works"
          aria-labelledby="steps-title"
        >
          <h2 id="steps-title">Get started in three steps</h2>
          <ol>
            {["Sign in", "Add your first task", "Make it yours"].map(
              (step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  {step}
                  {index < 2 ? <Arrow /> : null}
                </li>
              ),
            )}
          </ol>
        </section>
        <section
          className={styles.invitation}
          aria-labelledby="invitation-title"
        >
          <Image
            src="/landing/next-adventure.png"
            fill
            sizes="100vw"
            alt=""
            className={styles.footerArt}
          />
          <div>
            <h2 id="invitation-title">
              Start with <span>one task.</span>
            </h2>
            <GoogleSignInButton />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Brand />
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <Link href="/login">Sign in</Link>
        </nav>
      </footer>
    </div>
  );
}
