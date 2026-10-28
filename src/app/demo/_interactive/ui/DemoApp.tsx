"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { BRAND } from "@/app/demo/_interactive/brand";
import { canViewScene } from "@/app/demo/_interactive/state/permissions";
import type { SceneId } from "@/app/demo/_interactive/types";
import type { DemoView } from "@/app/demo/_interactive/view/url";
import { AccessDenied } from "./common";
import styles from "../demo-app.module.css";
import { DemoProvider, useDemo } from "./DemoProvider";
import { Notice, RoleBar, SideNav, TourBar, Toast, Topbar } from "./Shell";
import { AuditScene } from "./scenes/AuditScene";
import { BillingScene } from "./scenes/BillingScene";
import { DashboardScene } from "./scenes/DashboardScene";
import { FacilitiesScene } from "./scenes/FacilitiesScene";
import { OnboardingScene } from "./scenes/OnboardingScene";
import { PatientsScene } from "./scenes/PatientsScene";
import { DocumentsScene, NotesScene } from "./scenes/RecordScenes";

function Scene({ scene }: { scene: SceneId }) {
  switch (scene) {
    case "dashboard":
      return <DashboardScene />;
    case "patients":
      return <PatientsScene />;
    case "onboarding":
      return <OnboardingScene />;
    case "documents":
      return <DocumentsScene />;
    case "notes":
      return <NotesScene />;
    case "facilities":
      return <FacilitiesScene />;
    case "billing":
      return <BillingScene />;
    case "audit":
      return <AuditScene />;
  }
}

function Shell() {
  const { view, model, resetKey } = useDemo();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  // After a section or tour step changes, move focus to the content and scroll
  // to the top so keyboard and screen reader users land on the new view.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [view.scene, view.step, view.mode]);

  const allowed = canViewScene(model.role, view.scene);

  return (
    <div className={styles.root}>
    <div className="demo">
      <a className="skip-link" href="#demo-main">
        Skip to demo content
      </a>
      <Topbar />
      <Notice />
      <div className="dwrap demo-shell">
        <SideNav />
        <main id="demo-main" className="demo-main" ref={mainRef} tabIndex={-1}>
          {view.mode === "tour" ? <TourBar /> : null}
          <RoleBar />
          <div key={`${resetKey}-${view.scene}-${model.role}`} className="demo-scene">
            {allowed ? <Scene scene={view.scene} /> : <AccessDenied scene={view.scene} />}
          </div>
          <footer className="demo-footer">
            <p>{BRAND.legal.footerLine}</p>
            <p>
              {BRAND.legal.dataLine}{" "}
              <Link href="/demo/story" className="demo-footer__link">
                Watch the guided story
              </Link>
            </p>
          </footer>
        </main>
      </div>
      <Toast />
    </div>
    </div>
  );
}

export function DemoApp({ initialView }: { initialView: DemoView }) {
  return (
    <DemoProvider initialView={initialView}>
      <Shell />
    </DemoProvider>
  );
}
