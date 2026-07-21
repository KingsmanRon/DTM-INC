"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../demo.module.css";

const chapters = [
  {
    number: "01",
    short: "Duplicates",
    title: "Stop duplicate files before they start",
    body: "DTM checks legal identity and opens the existing patient file instead.",
    aria: "Exact identity duplicate prevention",
  },
  {
    number: "02",
    short: "Onboarding",
    title: "Onboard the complete patient",
    body: "Seven guided sections keep every intake complete and recoverable.",
    aria: "Complete seven section patient onboarding",
  },
  {
    number: "03",
    short: "Documents",
    title: "Keep documents with the patient",
    body: "Attach, verify and correct patient documents without losing accountability.",
    aria: "Secure patient document attachment",
  },
  {
    number: "04",
    short: "Clinical notes",
    title: "Write notes without rewriting history",
    body: "Finalise, amend and void notes while preserving the original record.",
    aria: "Defensible doctor only clinical notes",
  },
] as const;

const cursorPositions = [
  { x: 80, y: 73 },
  { x: 82, y: 83 },
  { x: 80, y: 38 },
  { x: 78, y: 31 },
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
  | "check"
  | "arrow"
  | "replay"
  | "lock"
  | "history"
  | "ledger";

export function DemoExperience({ initialChapter = 0 }: { initialChapter?: number }) {
  const storyRef = useRef<HTMLElement>(null);
  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeChapter, setActiveChapter] = useState(initialChapter);
  const [progress, setProgress] = useState(initialChapter / (chapters.length - 1));
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

      setProgress(nextProgress);
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

  useEffect(() => {
    if (initialChapter <= 0) return;
    chapterRefs.current[initialChapter]?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [initialChapter]);

  const scrollTo = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    },
    [reducedMotion],
  );

  const showChapter = useCallback(
    (index: number) => {
      setActiveChapter(index);
      setProgress(index / (chapters.length - 1));
      chapterRefs.current[index]?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
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
              See how DTM Inc. prevents duplicate files and turns first intake into a complete, defensible patient record.
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
                <button
                  type="button"
                  className={styles.chapterButton}
                  onClick={() => showChapter(index)}
                  aria-label={`Show ${chapter.title}`}
                >
                  <span className={styles.chapterNumber}>{chapter.number}</span>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.body}</p>
                </button>
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
                    <StagePane active={activeChapter === 0}><DuplicateStage /></StagePane>
                    <StagePane active={activeChapter === 1}><OnboardingStage /></StagePane>
                    <StagePane active={activeChapter === 2}><DocumentsStage /></StagePane>
                    <StagePane active={activeChapter === 3}><ClinicalNotesStage /></StagePane>
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
              From first search to a file <span>you can trust.</span>
            </h2>
            <p className={styles.finalLead}>
              Complete onboarding, patient documents and defensible clinical notes — held together by three guarantees that hold on every record.
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

          <TrustPanel />
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

function ProductChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.productWindow}>
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
              <strong>Duplicate protection before creation</strong>
              <span>Match the legal identity, then open the existing patient file.</span>
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
  const activeIndex = active === 0 || active === 1 ? 1 : active === 2 ? 2 : 3;

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

function DuplicateStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.mockPageHeading}>
        <div><h3>Check before creating</h3><p>DTM checks a normalised SA ID or passport before a new patient file is created.</p></div>
        <span className={styles.stepCounter}>Identity check</span>
      </div>
      <div className={styles.identityFields}>
        <MockField label="Identity type" value="South African ID" />
        <MockField label="ID number" value="900101 1234 082" />
      </div>
      <div className={styles.searchResultLabel}>Existing legal identity found</div>
      <div className={styles.searchResult}>
        <span className={styles.avatar}>TM</span>
        <div><strong>Mokoena, Thandi</strong><small>SA ID · 900101 1234 082</small></div>
        <span className={styles.fileNumber}>NTH-2026-0147</span>
        <span className={styles.activeStatus}>Active</span>
      </div>
      <div className={styles.identityNotice}>
        <span className={styles.closeIcon}><Icon name="shield" /></span>
        <div><strong>Duplicate file prevented</strong><small>Open the existing record instead of creating another patient.</small></div>
        <span className={styles.secondaryControl}>Open existing file</span>
      </div>
    </div>
  );
}

function OnboardingStage() {
  const steps = ["Patient", "Responsible", "Medical aid", "Emergency", "Referral", "Dependants", "Consent"];
  return (
    <div className={styles.mockPage}>
      <div className={styles.mockPageHeading}>
        <div><h3>Complete patient onboarding</h3><p>Every required section is reviewed before DTM generates the patient file.</p></div>
        <span className={styles.stepCounter}>Step 7 of 7</span>
      </div>
      <div className={styles.fullStepper}>
        {steps.map((step, index) => (
          <div className={index === steps.length - 1 ? styles.stepActive : styles.stepComplete} key={step}>
            <span>{index + 1}</span><small>{step}</small>
          </div>
        ))}
      </div>
      <div className={styles.completionGrid}>
        <CompletionItem label="Patient identity" value="SA ID verified" />
        <CompletionItem label="Responsible person" value="Captured" />
        <CompletionItem label="Medical aid" value="Ubuntu Health" />
        <CompletionItem label="Emergency contact" value="Captured" />
        <CompletionItem label="Referral and dependants" value="Reviewed" />
        <CompletionItem label="Consent" value="Signed in person" />
      </div>
      <div className={styles.mockFormFooter}>
        <span>Draft saved in this session · consent text current</span>
        <span className={styles.primaryControl}>Submit and generate file number</span>
      </div>
    </div>
  );
}

function DocumentsStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.patientHeader}>
        <span className={styles.avatarLarge}>TM</span>
        <div><h3>Mokoena, Thandi</h3><p><span>NTH-2026-0147</span> · Active patient</p></div>
        <span className={styles.activeStatus}>Patient file</span>
      </div>
      <div className={styles.mockTabs}>
        <span>Demographics</span><span className={styles.mockTabActive}>Documents</span><span>Clinical notes</span>
      </div>
      <div className={styles.documentUpload}>
        <div><small>Document category</small><strong>ID copy</strong></div>
        <div><small>Selected file</small><strong>thandi-mokoena-id.jpg</strong></div>
        <span className={styles.primaryControl}>Attach document</span>
      </div>
      <div className={styles.documentList}>
        <DocumentItem name="Thandi Mokoena ID copy.pdf" meta="ID copy · 428 KB · Optimised" />
        <DocumentItem name="Dr Naidoo referral letter.pdf" meta="Referral letter · 212 KB · Verified" />
      </div>
      <div className={styles.fileStrip}><Icon name="shield" /><div><strong>Checked before it joins the patient file</strong><span>Content verified, integrity recorded and viewing access controlled.</span></div></div>
    </div>
  );
}

function ClinicalNotesStage() {
  return (
    <div className={styles.mockPage}>
      <div className={styles.patientHeader}>
        <span className={styles.avatarLarge}>TM</span>
        <div><h3>Mokoena, Thandi</h3><p><span>NTH-2026-0147</span> · Doctor view</p></div>
        <span className={styles.doctorOnly}>Doctor only</span>
      </div>
      <div className={styles.mockTabs}>
        <span>Demographics</span><span>Documents</span><span className={styles.mockTabActive}>Clinical notes</span>
      </div>
      <div className={styles.noteComposer}>
        <div><small>New clinical note · 20 July 2026</small><strong>Wound clean and dry. Patient mobilising well. Continue current care plan.</strong></div>
        <span className={styles.primaryControl}>Save note</span>
      </div>
      <div className={styles.noteTimeline}>
        <div className={styles.noteSuperseded}>
          <div><strong>18 July 2026</strong><span>Finalised · Superseded</span></div>
          <p>Initial post operative review completed.</p>
        </div>
        <div className={styles.noteCurrent}>
          <div><strong>20 July 2026</strong><span>Finalised amendment</span></div>
          <p>Post operative review updated after follow up. Original note preserved.</p>
        </div>
      </div>
      <div className={styles.flowLine} aria-hidden="true"><span>Save</span><i /><span>Finalise</span><i /><span>Amend</span><i /><span>Void with reason</span></div>
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

function TrustPanel() {
  return (
    <div className={styles.trustPanel} aria-label="How DTM Inc. keeps the record trustworthy">
      <div className={styles.trustPanelHeader}>
        <span className={styles.trustBadge}>Why the record holds up</span>
        <p>Three guarantees run through every workflow in this tour.</p>
      </div>
      <ul className={styles.trustPillars}>
        <TrustPillar
          icon="lock"
          title="Controlled access"
          body="Clinical notes are invisible to reception and admin — absent, not merely blocked. Notes are encrypted at rest, and files open only through short-lived links."
          tags={["Role based", "Encrypted notes", "Expiring links"]}
        />
        <TrustPillar
          icon="history"
          title="Preserved history"
          body="Nothing is overwritten. Finalising locks a note, an amendment links a new version to the original, and a removed document is archived rather than destroyed."
          tags={["Locked on finalise", "Linked amendments", "Reason-backed voids"]}
        />
        <TrustPillar
          icon="ledger"
          title="Accountable actions"
          body="Every action lands in an append-only, hash-chained audit log that a daily check re-verifies from end to end."
          tags={["Tamper evident", "Daily verification", "Who and when"]}
        />
      </ul>
      <div className={styles.trustBilling}>
        <span className={styles.trustBillingIcon}><Icon name="billing" /></span>
        <div>
          <strong>Billing, as a supporting capability</strong>
          <span>Monthly per-hospital exports staged straight from these records — handled, not the headline.</span>
        </div>
      </div>
    </div>
  );
}

function TrustPillar({ icon, title, body, tags }: { icon: IconName; title: string; body: string; tags: readonly string[] }) {
  return (
    <li className={styles.trustPillar}>
      <span className={styles.trustPillarIcon}><Icon name={icon} /></span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        <span className={styles.trustTags}>
          {tags.map((tag) => <em key={tag}>{tag}</em>)}
        </span>
      </div>
    </li>
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

function CompletionItem({ label, value }: { label: string; value: string }) {
  return <div><span aria-hidden="true"><Icon name="check" /></span><small>{label}</small><strong>{value}</strong></div>;
}

function DocumentItem({ name, meta }: { name: string; meta: string }) {
  return (
    <div className={styles.documentItem}>
      <span className={styles.closeIcon}><Icon name="document" /></span>
      <div><strong>{name}</strong><small>{meta}</small></div>
      <span className={styles.activeStatus}>On file</span>
    </div>
  );
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
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    arrow: <><path d="M12 3v17M6 14l6 6 6-6" /></>,
    replay: <><path d="M5.2 8A8.5 8.5 0 1 1 4 13" /><path d="M4.7 3.5 5.2 8l4.5-.5" /></>,
    lock: <><rect x="4.75" y="10.25" width="14.5" height="10" rx="1.6" /><path d="M7.75 10.25V7.5a4.25 4.25 0 0 1 8.5 0v2.75" /><path d="M12 14v2.75" /></>,
    history: <><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" /><path d="M3 4.2V8h3.8" /><path d="M12 7.6V12l3 1.9" /></>,
    ledger: <><rect x="4.75" y="3.25" width="14.5" height="17.5" rx="1.5" /><path d="M8.25 8h7.5M8.25 12h7.5M8.25 16h4.75" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
