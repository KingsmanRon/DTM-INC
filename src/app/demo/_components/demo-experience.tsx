"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../demo.module.css";

const chapters = [
  {
    number: "01",
    short: "Intake",
    title: "Start with one search",
    body: "Find an existing file or begin a new patient in seconds.",
    aria: "Patient search and new patient onboarding",
  },
  {
    number: "02",
    short: "Capture",
    title: "Capture once",
    body: "A guided seven-step flow keeps every intake complete.",
    aria: "Seven-step patient intake form",
  },
  {
    number: "03",
    short: "Patient file",
    title: "Work from one patient file",
    body: "Demographics, documents and clinical notes stay together.",
    aria: "Unified patient record",
  },
  {
    number: "04",
    short: "Close",
    title: "Close the loop",
    body: "Prepare billing exports and retain an append-only audit trail.",
    aria: "Billing export and audit trail",
  },
] as const;

const cursorPositions = [
  { x: 80, y: 22 },
  { x: 83, y: 82 },
  { x: 44, y: 32 },
  { x: 79, y: 39 },
] as const;

type IconName =
  | "home"
  | "patient"
  | "document"
  | "calendar"
  | "billing"
  | "shield"
  | "search"
  | "folder"
  | "arrow"
  | "replay";

export function DemoExperience() {
  const storyRef = useRef<HTMLElement>(null);
  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeChapter, setActiveChapter] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.chapter);
        if (!Number.isInteger(index)) return;

        setActiveChapter(index);
        setProgress(index / (chapters.length - 1));
      },
      { rootMargin: "-30% 0px -30% 0px", threshold: [0.15, 0.35, 0.55] },
    );

    chapterRefs.current.forEach((chapter) => {
      if (chapter) observer.observe(chapter);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const story = storyRef.current;
      if (!story) return;

      const rect = story.getBoundingClientRect();
      const scrollable = Math.max(story.offsetHeight - window.innerHeight, 1);
      const travelled = Math.min(Math.max(-rect.top, 0), scrollable);
      const nextProgress = travelled / scrollable;
      const nextChapter = Math.min(chapters.length - 1, Math.floor(nextProgress * chapters.length));

      setProgress(nextProgress);
      setActiveChapter(nextChapter);
    };

    const queueUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const scrollTo = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    },
    [reducedMotion],
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero} id="top" aria-labelledby="demo-title">
        <DemoBrand />

        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <h1 id="demo-title" className={styles.heroTitle}>
              Patient admin,
              <span>without the</span>
              paperwork.
            </h1>
            <p className={styles.heroLead}>
              See how DTM Inc. moves a patient from first intake to a complete, auditable file.
            </p>
            <button className={styles.scrollButton} type="button" onClick={() => scrollTo("tour")}>
              <Icon name="arrow" />
              Scroll to begin
            </button>
            <p className={styles.disclaimer}>A guided product tour · Fictional demonstration data</p>
          </div>

          <div className={styles.heroProduct}>
            <HeroProductWindow />
            <HeroChapterRail />
          </div>
        </div>

        <button
          type="button"
          className={styles.heroScrollCue}
          onClick={() => scrollTo("tour")}
          aria-label="Begin the guided tour"
        >
          <span />
        </button>
      </section>

      <section className={styles.story} id="tour" ref={storyRef} aria-labelledby="tour-title">
        <h2 id="tour-title" className={styles.srOnly}>How the DTM Inc. workflow works</h2>
        <div className={styles.storyGrid}>
          <div className={styles.storyNarrative}>
            {chapters.map((chapter, index) => (
              <article
                className={`${styles.chapter} ${activeChapter === index ? styles.chapterActive : ""}`}
                key={chapter.number}
                data-chapter={index}
                ref={(element) => {
                  chapterRefs.current[index] = element;
                }}
                aria-current={activeChapter === index ? "step" : undefined}
              >
                <div className={styles.chapterNumber}>{chapter.number}</div>
                <h3>{chapter.title}</h3>
                <p>{chapter.body}</p>
              </article>
            ))}
          </div>

          <div className={styles.storyVisual}>
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <div className={styles.productStage} aria-live="polite" aria-label={chapters[activeChapter]?.aria}>
              <ProductChrome>
                <div className={styles.stageInner}>
                  <ProductSidebar active={activeChapter} />
                  <div className={styles.stageContent}>
                    <StagePane active={activeChapter === 0}><SearchStage /></StagePane>
                    <StagePane active={activeChapter === 1}><OnboardingStage /></StagePane>
                    <StagePane active={activeChapter === 2}><PatientFileStage /></StagePane>
                    <StagePane active={activeChapter === 3}><CloseLoopStage /></StagePane>
                  </div>
                </div>
              </ProductChrome>

              {!reducedMotion ? (
                <DemoCursor
                  chapter={activeChapter}
                  x={cursorPositions[activeChapter]?.x ?? cursorPositions[0].x}
                  y={cursorPositions[activeChapter]?.y ?? cursorPositions[0].y}
                />
              ) : null}
            </div>
            <p className={styles.scrollControls}><span aria-hidden="true" />Scroll controls the walkthrough</p>
          </div>
        </div>
      </section>

      <section className={styles.finalSection} aria-labelledby="final-title">
        <div className={styles.finalGrid}>
          <div className={styles.finalCopy}>
            <h2 id="final-title">
              From first intake to a file <span>you can trust.</span>
            </h2>
            <p className={styles.finalLead}>
              One guided workflow for patient details, documents, clinical notes, billing exports and accountable access.
            </p>
            <p className={styles.finalNote}>Built around the work your practice already does.</p>
            <div className={styles.finalActions}>
              <button type="button" className={styles.scrollButton} onClick={() => scrollTo("tour")}>
                <Icon name="replay" />
                Replay the tour
              </button>
              <button type="button" className={styles.textButton} onClick={() => scrollTo("top")}>
                <Icon name="arrow" />
                Return to the top
              </button>
            </div>
          </div>

          <JourneySummary />
        </div>

        <footer className={styles.demoFooter}>
          <span>DTM Inc.</span>
          <span>Fictional demonstration data</span>
          <span>No patient information is used on this page</span>
        </footer>
      </section>
    </main>
  );
}

function DemoBrand() {
  return (
    <div className={styles.brand} aria-label="DTM Inc.">
      <span className={styles.brandMark}>
        <Image src="/brand/logo.png" alt="" width={46} height={46} priority />
      </span>
      <span>
        <strong>DTM Inc.</strong>
        <small>Guided product tour</small>
      </span>
    </div>
  );
}

function ProductChrome({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`${styles.productWindow} ${compact ? styles.productWindowCompact : ""}`}>
      <div className={styles.windowBar} aria-hidden="true"><i /><i /><i /></div>
      {children}
    </div>
  );
}

function HeroProductWindow() {
  return (
    <ProductChrome>
      <div className={styles.heroApp}>
        <ProductSidebar active={0} compact />
        <div className={styles.heroAppContent}>
          <div className={styles.heroAppHeader}>
            <h2>Find a patient</h2>
            <div className={styles.mockSearch}><Icon name="search" />Search by name, ID or file number</div>
            <span className={styles.primaryControl}>New patient</span>
          </div>
          <div className={styles.patientRows}>
            <PatientRow name="Mokoena, Thandi" file="NTH-2026-0147" status="Active" />
            <PatientRow name="Dlamini, Nomsa" file="JHB-2026-0129" status="Active" muted />
            <PatientRow name="Naidoo, Aaliyah" file="JHB-2026-0118" status="Active" muted />
          </div>
          <div className={styles.heroOnboarding}>
            <div>
              <strong>Onboard a new patient</strong>
              <span>Capture the paper form once, then keep the file digital.</span>
            </div>
            <MiniStepper />
          </div>
        </div>
      </div>
      <div className={styles.heroCursor} aria-hidden="true"><CursorShape /><span /></div>
    </ProductChrome>
  );
}

function HeroChapterRail() {
  return (
    <ol className={styles.heroRail} aria-label="Tour chapters">
      {chapters.map((chapter, index) => (
        <li className={index === 0 ? styles.heroRailActive : ""} key={chapter.number}>
          <strong>{chapter.number}</strong>
          <span>{chapter.short}</span>
        </li>
      ))}
    </ol>
  );
}

function ProductSidebar({ active, compact = false }: { active: number; compact?: boolean }) {
  const items = useMemo(
    () => [
      { name: "home" as const, label: "Dashboard" },
      { name: "patient" as const, label: "Patients" },
      { name: "document" as const, label: "Documents" },
      { name: "calendar" as const, label: "Clinical notes" },
      { name: "billing" as const, label: "Billing" },
      { name: "shield" as const, label: "Audit" },
    ],
    [],
  );
  const activeIndex = active === 0 || active === 1 ? 1 : active === 2 ? 2 : 4;

  return (
    <aside className={`${styles.productSidebar} ${compact ? styles.productSidebarCompact : ""}`} aria-hidden="true">
      {items.map((item, index) => (
        <span className={index === activeIndex ? styles.sidebarActive : ""} key={item.label}>
          <Icon name={item.name} />
        </span>
      ))}
    </aside>
  );
}

function StagePane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={`${styles.stagePane} ${active ? styles.stagePaneActive : ""}`} aria-hidden={!active}>
      {children}
    </div>
  );
}

function SearchStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.mockPageHeading}>
        <div><h3>Find a patient</h3><p>Search by file number, name, ID, phone or medical aid number.</p></div>
        <span className={styles.primaryControl}>New patient</span>
      </div>
      <div className={styles.searchField}><Icon name="search" /><span>Thandi Mokoena</span><kbd>⌘ K</kbd></div>
      <div className={styles.searchResultLabel}>1 matching patient</div>
      <div className={styles.searchResult}>
        <span className={styles.avatar}>TM</span>
        <div><strong>Mokoena, Thandi</strong><small>SA ID · 900101 1234 082</small></div>
        <span className={styles.fileNumber}>NTH-2026-0147</span>
        <span className={styles.activeStatus}>Active</span>
      </div>
      <div className={styles.calloutLine}><span />One search keeps reception moving.</div>
    </div>
  );
}

function OnboardingStage() {
  const steps = ["Patient", "Responsible", "Medical aid", "Emergency", "Referral", "Dependants", "Consent"];
  return (
    <div className={styles.mockPage}>
      <div className={styles.mockPageHeading}>
        <div><h3>New patient onboarding</h3><p>Capture every section from the paper form.</p></div>
        <span className={styles.stepCounter}>Step 1 of 7</span>
      </div>
      <div className={styles.fullStepper}>
        {steps.map((step, index) => (
          <div className={index === 0 ? styles.stepActive : ""} key={step}>
            <span>{index + 1}</span><small>{step}</small>
          </div>
        ))}
      </div>
      <div className={styles.mockForm}>
        <MockField label="First names" value="Thandi" />
        <MockField label="Surname" value="Mokoena" />
        <MockField label="SA ID" value="900101 1234 082" />
        <MockField label="Mobile number" value="+27 82 123 4567" />
      </div>
      <div className={styles.mockFormFooter}>
        <span>Draft saved on this device</span>
        <span className={styles.primaryControl}>Continue</span>
      </div>
    </div>
  );
}

function PatientFileStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.patientHeader}>
        <span className={styles.avatarLarge}>TM</span>
        <div><h3>Mokoena, Thandi</h3><p><span>NTH-2026-0147</span> · Active patient</p></div>
        <span className={styles.secondaryControl}><Icon name="document" />Download onboarding PDF</span>
      </div>
      <div className={styles.mockTabs}>
        <span className={styles.mockTabActive}>Demographics</span><span>Documents</span><span>Clinical notes</span>
      </div>
      <div className={styles.recordGrid}>
        <div><small>Patient details</small><strong>Thandi Mokoena</strong><span>SA ID · 900101 1234 082</span></div>
        <div><small>Medical aid</small><strong>Ubuntu Health</strong><span>Membership · 8821047</span></div>
        <div><small>Contact</small><strong>+27 82 123 4567</strong><span>thandi@example.test</span></div>
        <div><small>Emergency contact</small><strong>Lerato Mokoena</strong><span>Sister · +27 82 555 0148</span></div>
      </div>
      <div className={styles.fileStrip}><Icon name="folder" /><div><strong>Everything stays with the patient</strong><span>Demographics, signed documents and role-controlled notes.</span></div></div>
    </div>
  );
}

function CloseLoopStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.mockPageHeading}>
        <div><h3>Close the loop</h3><p>Prepare the monthly hand-off and preserve accountable access.</p></div>
      </div>
      <div className={styles.closeStack}>
        <div className={styles.closePanel}>
          <span className={styles.closeIcon}><Icon name="billing" /></span>
          <div><small>Monthly billing export</small><strong>Netcare · July 2026</strong><span>12 patient files staged</span></div>
          <span className={styles.fileNumber}>DTM_Netcare_2026-07.xlsx</span>
          <span className={styles.primaryControl}>Generate .xlsx</span>
        </div>
        <div className={styles.closePanel}>
          <span className={styles.closeIcon}><Icon name="shield" /></span>
          <div><small>Append-only audit</small><strong>Billing export generated</strong><span>Recorded with user, time and action</span></div>
          <span className={styles.auditTime}>20 Jul 2026 · 14:32</span>
          <span className={styles.activeStatus}>Verified</span>
        </div>
      </div>
      <div className={styles.flowLine} aria-hidden="true"><span>Intake</span><i /><span>Patient file</span><i /><span>Billing</span><i /><span>Audit</span></div>
    </div>
  );
}

function DemoCursor({ x, y, chapter }: { x: number; y: number; chapter: number }) {
  return (
    <span
      key={chapter}
      className={styles.demoCursor}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <CursorShape />
      <i />
    </span>
  );
}

function CursorShape() {
  return (
    <svg viewBox="0 0 28 34" role="presentation">
      <path d="M3.2 2.7 24.4 20a1.5 1.5 0 0 1-.85 2.65l-8 .96 4.25 7.04-4.12 2.48-4.25-7.03-4.78 6.35a1.5 1.5 0 0 1-2.7-.78L.8 4.08A1.5 1.5 0 0 1 3.2 2.7Z" />
    </svg>
  );
}

function JourneySummary() {
  return (
    <div className={styles.journey}>
      <div className={styles.journeyRail} aria-hidden="true">
        {chapters.map((chapter) => <span key={chapter.number}><strong>{chapter.number}</strong><i />{chapter.short}</span>)}
      </div>
      <ProductChrome compact>
        <div className={styles.summaryFile}>
          <div className={styles.summaryHeader}>
            <span className={styles.avatarLarge}>TM</span>
            <div><strong>Thandi Mokoena</strong><span>File: NTH-2026-0147</span></div>
            <span className={styles.activeStatus}>Active</span>
          </div>
          <div className={styles.mockTabs}><span className={styles.mockTabActive}>Demographics</span><span>Documents</span><span>Clinical notes</span></div>
          <div className={styles.summaryFields}><span>First names<strong>Thandi</strong></span><span>Surname<strong>Mokoena</strong></span><span>File number<strong>NTH-2026-0147</strong></span><span>Mobile number<strong>+27 82 123 4567</strong></span></div>
        </div>
      </ProductChrome>
      <div className={styles.summaryStrip}>
        <Icon name="billing" /><div><strong>Billing export</strong><span>NTH-2026-0147_billing.xlsx</span></div><span className={styles.activeStatus}>Completed</span>
      </div>
      <div className={styles.summaryStrip}>
        <Icon name="shield" /><div><strong>Append-only audit</strong><span>Billing export generated · 20 Jul 2026 · 14:32</span></div><span className={styles.activeStatus}>Verified</span>
      </div>
    </div>
  );
}

function PatientRow({ name, file, status, muted = false }: { name: string; file: string; status: string; muted?: boolean }) {
  return (
    <div className={muted ? styles.patientRowMuted : ""}>
      <span>{name}</span><span>{file}</span><small>{status}</small>
    </div>
  );
}

function MiniStepper() {
  return <div className={styles.miniStepper} aria-hidden="true">{[1, 2, 3, 4].map((step) => <i className={step === 1 ? styles.miniStepActive : ""} key={step}>{step}</i>)}</div>;
}

function MockField({ label, value }: { label: string; value: string }) {
  return <label className={styles.mockField}><span>{label}</span><strong>{value}</strong></label>;
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" /></>,
    patient: <><circle cx="12" cy="7.5" r="4" /><path d="M4.5 21c.8-5 3.3-7.5 7.5-7.5S18.7 16 19.5 21" /></>,
    document: <><path d="M6 2.5h8l4 4V21.5H6z" /><path d="M14 2.5v4h4M9 11h6M9 15h6" /></>,
    calendar: <><rect x="3.5" y="5.5" width="17" height="15" rx="1.5" /><path d="M7.5 3v5M16.5 3v5M3.5 10h17M8 14h.1M12 14h.1M16 14h.1M8 17.5h.1M12 17.5h.1" /></>,
    billing: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 15h4" /></>,
    shield: <><path d="M12 2.5 20 6v5.5c0 5.2-3.2 8.4-8 10-4.8-1.6-8-4.8-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    folder: <path d="M2.5 6.5h7l2-2h10v15h-19z" />,
    arrow: <><path d="M12 3v17M6 14l6 6 6-6" /></>,
    replay: <><path d="M5.2 8A8.5 8.5 0 1 1 4 13" /><path d="M4.7 3.5 5.2 8l4.5-.5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
