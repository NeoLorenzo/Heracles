import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { LITERATURE_DOCUMENTS, renderMarkdown } from "./literature.js";
import { createBodyWeightFeature } from "./features/body-weight.js";
import { createPresetFeature } from "./features/presets.js";
import { createDashboardFeature } from "./features/dashboard.js";
import { createSessionFeature } from "./features/session/session-controller.js";
import { persistSessionHistoryExerciseCorrection } from "./features/session/history-correction.js";
import { initializePullToRefresh } from "./features/pull-to-refresh.js";
import {
  activityCalendarStart,
  buildActivityCalendar,
  countWorkingSetsByDay,
  toLocalIsoDate,
} from "./features/activity-heatmap.js";
import { classifySet, formatSetClassification, isAnalyticalWorkingSet, usesPerDumbbellLoad } from "./set-model.js";

const PAGE_TITLES = Object.freeze({
  home: "Home",
  "live-session": "Live Workout",
  "session-history": "Session history",
  "my-data": "My data",
  "my-stuff": "My Stuff",
  literature: "Literature",
  settings: "Settings",
  document: "Literature",
});

const URL_BACKED_SIGNED_IN_PAGES = new Set([
  "home",
  "live-session",
  "session-history",
  "my-data",
  "my-stuff",
  "literature",
  "settings",
]);

const loadingView = document.querySelector("#loading");
const signedOutView = document.querySelector("#signed-out");
const signedInView = document.querySelector("#signed-in");
const signInButton = document.querySelector("#google-sign-in");
const publicDocumentSignInButton = document.querySelector("#public-document-sign-in");
const signInButtons = [signInButton, publicDocumentSignInButton, ...document.querySelectorAll("[data-sign-in]")];
const signOutButton = document.querySelector("#sign-out");
const errorMessage = document.querySelector("#auth-error");
const publicHome = document.querySelector("#public-home");
const publicDocumentPage = document.querySelector("#public-document-page");
const publicDocumentBack = document.querySelector("#public-document-back");
const publicDocumentLabel = document.querySelector("#public-document-label");
const publicDocumentTitle = document.querySelector("#public-document-title");
const publicDocumentStatus = document.querySelector("#public-document-status");
const publicDocumentContent = document.querySelector("#public-document-content");
const datasetStatus = document.querySelector("#dataset-status");
const startSessionButton = document.querySelector("#start-session");
const startSessionStatus = document.querySelector("#start-session-status");
const homeDate = document.querySelector("#home-date");
const homeGreeting = document.querySelector("#home-greeting");
const homeHero = document.querySelector("#home-hero");
const homeHeroStatus = document.querySelector("#home-hero-status");
const homeHeroTitle = document.querySelector("#home-hero-title");
const homeHeroCopy = document.querySelector("#home-hero-copy");
const homeRecentList = document.querySelector("#home-recent-list");
const homeRecentStatus = document.querySelector("#home-recent-status");
const HOME_RECENT_SESSION_LIMIT = 5;
let homeRecentRequestId = 0;
const homeActivitySection = document.querySelector(".home-activity");
const homeActivityHeatmap = document.querySelector("#home-activity-heatmap");
const homeActivitySummary = document.querySelector("#home-activity-summary");
const homeActivityStatus = document.querySelector("#home-activity-status");
const homeActivityTooltip = document.querySelector("#home-activity-tooltip");
let homeActivityRequestId = 0;
const sessionModal = document.querySelector("#session-modal");
const closeSessionModalButton = document.querySelector("#close-session-modal");
const sessionStartChoices = document.querySelector("#session-start-choices");
const sessionFromPresetButton = document.querySelector("#session-from-preset");
const sessionFromScratchButton = document.querySelector("#session-from-scratch");
const sessionPresetPicker = document.querySelector("#session-preset-picker");
const backToSessionChoicesButton = document.querySelector("#back-to-session-choices");
const sessionInProgress = document.querySelector("#session-in-progress");
const concludeSessionButton = document.querySelector("#conclude-session");
const sessionModalStatus = document.querySelector("#session-modal-status");
const liftList = document.querySelector("#lift-list");
const loadMoreButton = document.querySelector("#load-more");
const sessionSearch = document.querySelector("#session-search");
const clearSessionSearchButton = document.querySelector("#clear-session-search");
const sessionExerciseOptions = document.querySelector("#session-exercise-options");
const muscleViewInputs = [...document.querySelectorAll('input[name="muscle-view"]')];
const menuToggle = document.querySelector("#menu-toggle");
const appMenu = document.querySelector("#app-menu");
const menuBackdrop = document.querySelector("#menu-backdrop");
const sidebarRail = document.querySelector("#sidebar-rail");
const currentPageTitle = document.querySelector("#current-page-title");
const SIDEBAR_STORAGE_KEY = "fabbro:application-sidebar-expanded";
const sidebarMedia = window.matchMedia("(max-width: 900px)");
let sidebarExpanded = readSidebarPreference();
const topBar = document.querySelector(".top-bar");
const menuItems = [...document.querySelectorAll("[data-page]")];
const pagePanels = [...document.querySelectorAll("[data-page-panel]")];
const documentBack = document.querySelector("#document-back");
const documentLabel = document.querySelector("#document-label");
const documentTitle = document.querySelector("#document-title");
const documentStatus = document.querySelector("#document-status");
const documentContent = document.querySelector("#document-content");
const pageSize = 20;
let loadedRows = 0;
let totalRows = 0;
let loadingRows = false;
let sessionSearchQuery = "";
let sessionSearchTimer = null;
let sessionRequestVersion = 0;
let supabaseClient = null;
let activeUserId = null;
let documentRequestId = 0;
let exerciseMuscleLookup = new Map();
let exerciseMuscleLookupPromise = null;
let muscleViewMode = "ui";
let activePageName = "home";
let globalExerciseCatalogue = [];
let globalExerciseCataloguePromise = null;
let equipmentCatalogue = null;
let equipmentCataloguePromise = null;
let activeWorkoutSession = null;
let activeSessionLoadedForUser = null;
let activeSessionLoadingForUser = null;
const liveSessionFeature = createSessionFeature({
  getClient: () => supabaseClient,
  getUserId: () => activeUserId,
  ensureExerciseCatalogue: () => ensureGlobalExerciseCatalogue(supabaseClient),
  onNavigate: (page) => showPage(page),
  onSessionConcluded: () => {
    activeWorkoutSession = null;
    activeSessionLoadedForUser = activeUserId;
    updateSessionButton();
    showPage("home");
    dashboardFeature.invalidate();
    if (activeUserId && supabaseClient) void loadSessions(supabaseClient);
  },
  onSessionCancelled: () => {
    activeWorkoutSession = null;
    activeSessionLoadedForUser = activeUserId;
    updateSessionButton();
    showPage("home");
    dashboardFeature.invalidate();
    if (activeUserId && supabaseClient) void loadSessions(supabaseClient);
  },
  onSyncStateChange: (state, label) => {
    const topBarSyncBadge = document.querySelector("#top-bar-sync-badge");
    if (topBarSyncBadge) {
      topBarSyncBadge.className = `live-sync-badge sync-state-${state || "saved"}`;
      topBarSyncBadge.textContent = label || "Saved ✓";
    }
  },
  liveContainer: typeof document !== "undefined" ? document.querySelector("#live-session-container") : null,
  wizardModal: typeof document !== "undefined" ? (document.querySelector("#session-wizard-modal") || document.querySelector("#session-modal")) : null,
});
initializePullToRefresh();
const bodyWeightFeature = createBodyWeightFeature({
  getClient: () => supabaseClient,
  getUserId: () => activeUserId,
  onInvalidateE1rmPresentations: () => dashboardFeature.invalidate(),
});
const presetsFeature = createPresetFeature({
  getClient: () => supabaseClient,
  getUserId: () => activeUserId,
  ensureExerciseCatalogue: () => ensureGlobalExerciseCatalogue(supabaseClient),
  onStartPreset: (presetId, presetName) => {
    liveSessionFeature.openStartWizard(presetId, presetName);
  },
});
const dashboardFeature = createDashboardFeature({
  getClient: () => supabaseClient,
  getUserId: () => activeUserId,
  getActivePageName: () => activePageName,
  ensureExerciseMuscleLookup: (supabase) => ensureExerciseMuscleLookup(supabase),
  ensureBodyWeightState: () => bodyWeightFeature.ensureState(),
  getBodyWeightState: () => bodyWeightFeature.getState(),
});
syncSidebarForViewport();

menuToggle.addEventListener("click", () => {
  if (isSidebarMobile()) {
    if (appMenu.dataset.mobileOpen === "true") closeMenu();
    else openMenu();
    return;
  }

  setSidebarExpanded(!sidebarExpanded);
});

sidebarRail?.addEventListener("click", () => {
  if (!isSidebarMobile()) setSidebarExpanded(!sidebarExpanded);
});

menuBackdrop.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isSidebarMobile() && appMenu.dataset.mobileOpen === "true") {
    closeMenu();
    menuToggle.focus();
  }
});

for (const menuItem of menuItems) {
  menuItem.addEventListener("click", () => showPage(menuItem.dataset.page));
}
document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-page-link]");
  if (link) showPage(link.dataset.pageLink);
});

for (const input of muscleViewInputs) {
  input.addEventListener("change", () => {
    if (input.checked) setMuscleViewMode(input.value);
  });
}
window.addEventListener("scroll", updateContextualNavTitle, { passive: true });
window.addEventListener("resize", updateContextualNavTitle);
window.addEventListener("resize", syncSidebarForViewport);

sessionSearch.addEventListener("input", () => {
  clearSessionSearchButton.hidden = sessionSearch.value.length === 0;
  window.clearTimeout(sessionSearchTimer);
  sessionSearchTimer = window.setTimeout(() => {
    sessionSearchQuery = sessionSearch.value.trim();
    resetSessionResults();
    if (activeUserId && supabaseClient) void loadSessions(supabaseClient);
  }, 250);
});

clearSessionSearchButton.addEventListener("click", () => {
  window.clearTimeout(sessionSearchTimer);
  sessionSearch.value = "";
  sessionSearchQuery = "";
  clearSessionSearchButton.hidden = true;
  resetSessionResults();
  if (activeUserId && supabaseClient) void loadSessions(supabaseClient);
  sessionSearch.focus();
});
startSessionButton.addEventListener("click", startOrResumeSession);
closeSessionModalButton.addEventListener("click", closeSessionModal);
sessionFromScratchButton.addEventListener("click", () => createWorkoutSession());
sessionFromPresetButton.addEventListener("click", () => {
  presetsFeature.openSessionPresetPicker();
});
backToSessionChoicesButton.addEventListener("click", showSessionStartChoices);
concludeSessionButton.addEventListener("click", concludeActiveSession);
sessionModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSessionModal();
});

documentBack.addEventListener("click", () => showPage("literature"));
publicDocumentBack.addEventListener("click", () => showPublicHome());
document.addEventListener("click", (event) => {
  const documentLink = event.target.closest("[data-document]");
  if (!documentLink) return;
  event.preventDefault();
  if (signedInView.hidden) {
    void openPublicLiteratureDocument(documentLink.dataset.document);
  } else {
    void openLiteratureDocument(documentLink.dataset.document);
  }
});

window.addEventListener("popstate", () => {
  if (!signedInView.hidden) {
    showPage(readSignedInPageFromUrl(), { updateHistory: false });
    return;
  }
  const documentId = new URLSearchParams(window.location.search).get("literature");
  if (documentId && LITERATURE_DOCUMENTS[documentId]) {
    void openPublicLiteratureDocument(documentId, false);
  } else {
    showPublicHome(false);
  }
});

const configured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("__SUPABASE_") &&
  SUPABASE_PUBLISHABLE_KEY.length > 20 &&
  !SUPABASE_PUBLISHABLE_KEY.includes("__SUPABASE_");

if (!configured) {
  showSignedOut();
  showError("Supabase has not been configured yet.");
  setSignInDisabled(true);
} else {
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      detectSessionInUrl: true,
      flowType: "pkce",
      persistSession: true,
    },
  });
  supabaseClient = supabase;

  for (const button of signInButtons) button.addEventListener("click", async () => {
    clearError();
    setSignInDisabled(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL("./", window.location.href).href,
      },
    });

    if (error) {
      showError(error.message);
      setSignInDisabled(false);
    }
  });

  signOutButton.addEventListener("click", async () => {
    closeMenu();
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();

    if (error) {
      showError(error.message);
      signOutButton.disabled = false;
    }
  });

  loadMoreButton.addEventListener("click", () => {
    void loadSessions(supabase);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    renderSession(session);
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showSignedOut();
    showError(error.message);
  } else {
    renderSession(data.session);
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app still works online if service-worker registration is unavailable.
    });
  });
}

function renderSession(session) {
  if (session) {
    if (activeUserId === session.user.id && !signedInView.hidden) return;

    document.body.classList.add("is-authenticated");
    activeUserId = session.user.id;
    loadingView.hidden = true;
    signedOutView.hidden = true;
    signedInView.hidden = false;
    signOutButton.disabled = false;
    clearError();
    const pageName = readSignedInPageFromUrl();
    if (hasInvalidSignedInPageInUrl() || new URLSearchParams(window.location.search).has("literature")) {
      synchronizeSignedInPageUrl(pageName, { replace: true });
    }
    showPage(pageName, { updateHistory: false });
    resetActiveSession();
    resetLiftList();
    dashboardFeature.reset();
    presetsFeature.reset();
    bodyWeightFeature.reset();
    window.setTimeout(() => {
      void loadActiveSession(supabaseClient);
      void ensureGlobalExerciseCatalogue(supabaseClient).then(populateSessionExerciseOptions).catch(() => {});
      void bodyWeightFeature.ensureState();
      void loadSessions(supabaseClient);
    }, 0);
    return;
  }

  showSignedOut();
}

function showSignedOut() {
  document.body.classList.remove("is-authenticated");
  activeUserId = null;
  loadingView.hidden = true;
  signedInView.hidden = true;
  signedOutView.hidden = false;
  setSignInDisabled(false);
  closeMenu();
  resetActiveSession();
  resetLiftList();
  dashboardFeature.reset();
  presetsFeature.reset();
  bodyWeightFeature.reset();
  liveSessionFeature.reset();
  const documentId = new URLSearchParams(window.location.search).get("literature");
  if (documentId && LITERATURE_DOCUMENTS[documentId]) {
    void openPublicLiteratureDocument(documentId, false);
  } else {
    showPublicHome(false);
  }
}

function setSignInDisabled(disabled) {
  for (const button of signInButtons) button.disabled = disabled;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  if (!publicDocumentPage.hidden) {
    publicDocumentStatus.textContent = message;
    publicDocumentStatus.hidden = false;
  }
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function readSidebarPreference() {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function isSidebarMobile() {
  return sidebarMedia.matches;
}

function setSidebarExpanded(expanded, { persist = true } = {}) {
  sidebarExpanded = Boolean(expanded);
  signedInView.dataset.sidebarState = sidebarExpanded ? "expanded" : "collapsed";
  appMenu.dataset.state = sidebarExpanded ? "expanded" : "collapsed";

  if (!isSidebarMobile()) {
    menuToggle.setAttribute("aria-expanded", String(sidebarExpanded));
    menuToggle.setAttribute(
      "aria-label",
      sidebarExpanded ? "Collapse navigation" : "Expand navigation",
    );
  }

  if (persist) {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarExpanded));
    } catch {
      // Keep the preference for the current session when storage is unavailable.
    }
  }
}

function syncSidebarForViewport() {
  if (isSidebarMobile()) {
    appMenu.dataset.mobileOpen = "false";
    appMenu.inert = true;
    appMenu.setAttribute("aria-hidden", "true");
    menuBackdrop.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    return;
  }

  appMenu.dataset.mobileOpen = "false";
  appMenu.inert = false;
  appMenu.setAttribute("aria-hidden", "false");
  menuBackdrop.hidden = true;
  setSidebarExpanded(sidebarExpanded, { persist: false });
}

function openMenu() {
  if (!isSidebarMobile()) {
    setSidebarExpanded(true);
    return;
  }

  appMenu.dataset.mobileOpen = "true";
  appMenu.inert = false;
  appMenu.setAttribute("aria-hidden", "false");
  menuBackdrop.hidden = false;
  menuToggle.setAttribute("aria-expanded", "true");
  menuToggle.setAttribute("aria-label", "Close navigation");
  appMenu.querySelector(".menu-item.is-active")?.focus();
}

function closeMenu() {
  if (!isSidebarMobile()) return;

  appMenu.dataset.mobileOpen = "false";
  appMenu.inert = true;
  appMenu.setAttribute("aria-hidden", "true");
  menuBackdrop.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
}

function readSignedInPageFromUrl() {
  const pageName = new URLSearchParams(window.location.search).get("page");
  return URL_BACKED_SIGNED_IN_PAGES.has(pageName) ? pageName : "home";
}

function hasInvalidSignedInPageInUrl() {
  const pageName = new URLSearchParams(window.location.search).get("page");
  return pageName !== null && !URL_BACKED_SIGNED_IN_PAGES.has(pageName);
}

function synchronizeSignedInPageUrl(pageName, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (pageName === "home") url.searchParams.delete("page");
  else url.searchParams.set("page", pageName);
  url.searchParams.delete("literature");

  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState({ page: pageName }, "", url);
  else window.history.pushState({ page: pageName }, "", url);
}

function showPage(pageName, { updateHistory = true } = {}) {
  if (updateHistory && activeUserId && URL_BACKED_SIGNED_IN_PAGES.has(pageName)) {
    synchronizeSignedInPageUrl(pageName);
  }
  const activeMenuPage = pageName === "document" ? "literature" : pageName;

  for (const panel of pagePanels) {
    panel.hidden = panel.dataset.pagePanel !== pageName;
  }

  for (const item of menuItems) {
    const isActive = item.dataset.page === activeMenuPage;
    item.classList.toggle("is-active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }

  activePageName = pageName;
  currentPageTitle.textContent = "";
  closeMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
  window.requestAnimationFrame(updateContextualNavTitle);
  if (pageName === "home") renderHomeGreeting();
  if (pageName === "home" && activeUserId && supabaseClient) {
    void loadHomeRecentSessions(supabaseClient);
    void loadHomeActivity(supabaseClient);
  }
  if (pageName === "live-session" && activeUserId && supabaseClient) {
    void liveSessionFeature.load();
  }
  if (pageName === "session-history" && activeUserId && supabaseClient) {
    void loadSessions(supabaseClient);
  }
  if (pageName === "my-data" && activeUserId && supabaseClient) {
    void dashboardFeature.load();
  }
  if (pageName === "my-stuff" && activeUserId && supabaseClient) {
    void presetsFeature.load();
  }
  if (pageName === "settings" && activeUserId && supabaseClient) {
    void bodyWeightFeature.loadSummary();
  }
}

function updateContextualNavTitle() {
  if (!topBar) return;
  const activePanel = pagePanels.find((panel) => panel.dataset.pagePanel === activePageName);
  const heading = activePanel?.querySelector("h1, [data-page-heading-anchor]");
  let pageTitle = activePageName === "document"
    ? documentTitle.textContent || PAGE_TITLES.document
    : PAGE_TITLES[activePageName] ?? "Home";

  if (activePageName === "live-session") {
    const activeSession = liveSessionFeature.getActiveSession();
    pageTitle = activeSession?.source_preset_name || "Live Workout";
  }

  const topBarSyncBadge = document.querySelector("#top-bar-sync-badge");

  if (!heading) {
    currentPageTitle.textContent = pageTitle;
    if (topBarSyncBadge) topBarSyncBadge.hidden = true;
    return;
  }
  const headingBottom = heading.getBoundingClientRect().bottom;
  const topBarBottom = topBar.getBoundingClientRect().bottom;
  const isContextual = headingBottom <= topBarBottom;
  currentPageTitle.textContent = isContextual ? pageTitle : "";

  const contextualDashboardRange = document.querySelector("#contextual-dashboard-range");
  const dashboardPageRange = document.querySelector("#dashboard-page-range");
  const isDashboardRangeContextual = activePageName === "my-data" && isContextual;
  if (contextualDashboardRange) contextualDashboardRange.hidden = !isDashboardRangeContextual;
  if (dashboardPageRange) dashboardPageRange.hidden = isDashboardRangeContextual;

  if (topBarSyncBadge) {
    if (activePageName === "live-session" && isContextual) {
      topBarSyncBadge.hidden = false;
      const inPageBadge = document.querySelector("#live-session-container .live-sync-badge");
      if (inPageBadge) {
        topBarSyncBadge.className = inPageBadge.className;
        topBarSyncBadge.textContent = inPageBadge.textContent;
      }
    } else {
      topBarSyncBadge.hidden = true;
    }
  }
}
async function openLiteratureDocument(documentId) {
  const documentDefinition = LITERATURE_DOCUMENTS[documentId];
  if (!documentDefinition) return;

  const requestId = ++documentRequestId;
  showPage("document");
  documentLabel.textContent = documentDefinition.label;
  documentTitle.textContent = documentDefinition.title;
  window.requestAnimationFrame(updateContextualNavTitle);
  documentStatus.textContent = "Loading document…";
  documentStatus.hidden = false;
  documentContent.replaceChildren();

  try {
    const response = await fetch(documentDefinition.path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Document request failed (${response.status})`);
    const markdown = await response.text();
    if (requestId !== documentRequestId) return;
    documentContent.innerHTML = renderMarkdown(markdown);
    documentStatus.hidden = true;
  } catch (error) {
    if (requestId !== documentRequestId) return;
    documentStatus.textContent = `Could not load this document: ${error.message}`;
  }
}

async function openPublicLiteratureDocument(documentId, updateHistory = true) {
  const documentDefinition = LITERATURE_DOCUMENTS[documentId];
  if (!documentDefinition) return;

  const requestId = ++documentRequestId;
  publicHome.hidden = true;
  publicDocumentPage.hidden = false;
  publicDocumentLabel.textContent = documentDefinition.label;
  publicDocumentTitle.textContent = documentDefinition.title;
  publicDocumentStatus.textContent = "Loading document…";
  publicDocumentStatus.hidden = false;
  publicDocumentContent.replaceChildren();
  document.title = `${documentDefinition.title} | Heracles`;
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("literature", documentId);
    window.history.pushState({ literature: documentId }, "", url);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const response = await fetch(documentDefinition.path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Document request failed (${response.status})`);
    const markdown = await response.text();
    if (requestId !== documentRequestId) return;
    publicDocumentContent.innerHTML = renderMarkdown(markdown);
    publicDocumentStatus.hidden = true;
  } catch (error) {
    if (requestId !== documentRequestId) return;
    publicDocumentStatus.textContent = `Could not load this document: ${error.message}`;
  }
}

function showPublicHome(updateHistory = true) {
  documentRequestId += 1;
  publicDocumentPage.hidden = true;
  publicHome.hidden = false;
  document.title = "Heracles | Evidence-aware training data";
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete("literature");
    window.history.pushState({}, "", url);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function ensureGlobalExerciseCatalogue(supabase) {
  if (globalExerciseCatalogue.length) return globalExerciseCatalogue;
  if (globalExerciseCataloguePromise) return globalExerciseCataloguePromise;

  globalExerciseCataloguePromise = (async () => {
    const exercises = [];
    const batchSize = 1000;
    let expectedCount = null;

    while (expectedCount === null || exercises.length < expectedCount) {
      const start = exercises.length;
      const { data, error, count } = await supabase
        .from("exercises")
        .select("id, code, name", { count: start === 0 ? "exact" : undefined })
        .eq("is_active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(start, start + batchSize - 1);

      if (error) throw error;
      if (expectedCount === null) expectedCount = count ?? data.length;
      exercises.push(...data);
      if (data.length < batchSize) break;
    }

    globalExerciseCatalogue = exercises;
    return exercises;
  })().catch((error) => {
    globalExerciseCataloguePromise = null;
    throw error;
  });

  return globalExerciseCataloguePromise;
}

function populateSessionExerciseOptions(exercises) {
  const options = document.createDocumentFragment();
  for (const exercise of exercises) {
    const option = document.createElement("option");
    option.value = exercise.name;
    options.append(option);
  }
  sessionExerciseOptions.replaceChildren(options);
}

async function loadActiveSession(supabase) {
  const requestedUserId = activeUserId;
  if (!requestedUserId) return;
  if (activeSessionLoadedForUser === requestedUserId || activeSessionLoadingForUser === requestedUserId) return;

  activeSessionLoadingForUser = requestedUserId;
  setSessionButtonLoading(true);
  clearSessionWorkflowStatus();

  try {
    const session = await liveSessionFeature.load();
    if (requestedUserId !== activeUserId) return;
    activeSessionLoadingForUser = null;
    activeWorkoutSession = session;
    activeSessionLoadedForUser = requestedUserId;
    updateSessionButton();
  } catch (error) {
    if (requestedUserId !== activeUserId) return;
    activeSessionLoadingForUser = null;
    showSessionWorkflowError(`Could not load your active session: ${error.message}`);
    startSessionButton.textContent = "Create Session";
    startSessionButton.disabled = false;
    renderHomeHero();
  }
}

function startOrResumeSession() {
  if (activeWorkoutSession) {
    showPage("live-session");
  } else {
    liveSessionFeature.openStartWizard();
  }
}

function showSessionStartChoices() {
  sessionStartChoices.hidden = false;
  sessionPresetPicker.hidden = true;
  sessionInProgress.hidden = true;
  sessionModal.setAttribute("aria-labelledby", "session-modal-title");
  clearSessionWorkflowStatus();
  sessionFromPresetButton.focus();
}

function showSessionInProgress() {
  sessionStartChoices.hidden = true;
  sessionPresetPicker.hidden = true;
  sessionInProgress.hidden = false;
  sessionModal.setAttribute("aria-labelledby", "session-progress-title");
  clearSessionWorkflowStatus();
  concludeSessionButton.focus();
}

async function createWorkoutSession(presetId = null, presetName = null) {
  liveSessionFeature.openStartWizard(presetId, presetName);
}

function setSessionCreationBusy(busy) {
  sessionFromPresetButton.disabled = busy;
  sessionFromScratchButton.disabled = busy;
  backToSessionChoicesButton.disabled = busy;
  const sessionPresetList = document.querySelector("#session-preset-list");
  if (sessionPresetList) {
    for (const button of sessionPresetList.querySelectorAll("button")) button.disabled = busy;
  }
}

async function concludeActiveSession() {
  if (!activeWorkoutSession || !activeUserId || !supabaseClient) return;
  const concludingSessionId = activeWorkoutSession.id;
  concludeSessionButton.disabled = true;
  concludeSessionButton.textContent = "Concluding…";
  sessionModalStatus.hidden = true;

  const { error } = await supabaseClient
    .from("workout_sessions")
    .update({ status: "completed" })
    .eq("id", concludingSessionId)
    .eq("owner_id", activeUserId)
    .eq("status", "in_progress")
    .select("id")
    .single();

  concludeSessionButton.disabled = false;
  concludeSessionButton.textContent = "Conclude Session";
  if (error) {
    sessionModalStatus.textContent = `Could not conclude your session: ${error.message}`;
    sessionModalStatus.hidden = false;
    return;
  }

  activeWorkoutSession = null;
  closeSessionModal();
  updateSessionButton();
  resetSessionResults();
  dashboardFeature.invalidate();
}

function openSessionModal() {
  clearSessionWorkflowStatus();
  if (!sessionModal.open) sessionModal.showModal();
  document.body.classList.add("session-modal-open");
}

function closeSessionModal() {
  if (sessionModal.open) sessionModal.close();
  document.body.classList.remove("session-modal-open");
  sessionModalStatus.hidden = true;
}

function updateSessionButton() {
  startSessionButton.textContent = activeWorkoutSession ? "Resume Session" : "Create Session";
  startSessionButton.disabled = false;
  renderHomeHero();
  window.requestAnimationFrame(updateContextualNavTitle);
}

function renderHomeHero() {
  const active = Boolean(activeWorkoutSession);
  if (homeHero) homeHero.dataset.state = active ? "active" : "idle";
  homeHero?.classList.toggle("is-active", active);
  if (homeHeroStatus) homeHeroStatus.textContent = active ? "Workout in progress" : "Ready to train";
  if (homeHeroTitle) {
    homeHeroTitle.textContent = active
      ? activeWorkoutSession.source_preset_name || "Live workout"
      : "Start a workout";
  }
  if (homeHeroCopy) {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const started = activeWorkoutSession?.performed_on === todayIso ? "today" : formatDate(activeWorkoutSession?.performed_on ?? todayIso);
    homeHeroCopy.textContent = active
      ? `Started ${started}. Your logged sets are saved — pick up where you left off.`
      : "Pick a gym and a preset, or begin with an empty session and add exercises as you go.";
  }
}

function renderHomeGreeting(now = new Date()) {
  if (homeDate) {
    homeDate.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(now);
  }
  if (homeGreeting) {
    const hour = now.getHours();
    homeGreeting.textContent = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }
}

async function loadHomeRecentSessions(supabase) {
  if (!homeRecentList || !homeRecentStatus) return;
  const requestId = ++homeRecentRequestId;
  const requestedUserId = activeUserId;
  if (!homeRecentList.childElementCount) {
    homeRecentStatus.textContent = "Loading recent sessions…";
    homeRecentStatus.hidden = false;
  }

  const [{ data, error }] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select("id, performed_on, status, source_preset_name, gyms(name), session_exercises(id, exercise_id, exercise_sets(weight, reps, is_warmup, reported_rir_bucket))")
      .eq("owner_id", requestedUserId)
      .order("performed_on", { ascending: false })
      .order("id", { ascending: false })
      .limit(HOME_RECENT_SESSION_LIMIT),
    ensureExerciseMuscleLookup(supabase).catch(() => null),
  ]);

  if (requestId !== homeRecentRequestId || requestedUserId !== activeUserId) return;
  if (error) {
    homeRecentStatus.textContent = `Could not load recent sessions: ${error.message}`;
    homeRecentStatus.hidden = false;
    return;
  }
  if (!data.length) {
    homeRecentList.replaceChildren();
    homeRecentList.hidden = true;
    homeRecentStatus.textContent = "No sessions yet. Your completed workouts will appear here.";
    homeRecentStatus.hidden = false;
    return;
  }

  homeRecentList.replaceChildren(...data.map(createHomeRecentItem));
  homeRecentList.hidden = false;
  homeRecentStatus.hidden = true;
}

function createHomeRecentItem(session) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "home-recent-item";
  button.dataset.pageLink = session.status === "in_progress" ? "live-session" : "session-history";

  const [year, month, day] = session.performed_on.split("-").map(Number);
  const performedOn = new Date(year, month - 1, day);
  const dateBlock = document.createElement("span");
  dateBlock.className = "home-recent-date";
  dateBlock.setAttribute("aria-hidden", "true");
  const dayNumber = document.createElement("strong");
  dayNumber.textContent = String(day);
  const monthLabel = document.createElement("small");
  monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "short" }).format(performedOn);
  dateBlock.append(dayNumber, monthLabel);

  const copy = document.createElement("span");
  copy.className = "home-recent-copy";
  const title = document.createElement("strong");
  title.textContent = session.source_preset_name || session.gyms?.name || "Workout session";
  const exercises = session.session_exercises ?? [];
  const workingSetCount = exercises.reduce(
    (count, exercise) => count + (exercise.exercise_sets ?? []).filter(isAnalyticalWorkingSet).length,
    0,
  );
  const context = document.createElement("span");
  context.textContent = [
    session.source_preset_name && session.gyms?.name ? session.gyms.name : null,
    `${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"}`,
    session.status === "in_progress" ? null : `${workingSetCount} working ${workingSetCount === 1 ? "set" : "sets"}`,
  ].filter(Boolean).join(" · ");
  copy.append(title, context);

  const uiGroups = [...new Map(
    exercises
      .filter((exercise) => (exercise.exercise_sets ?? []).some(isAnalyticalWorkingSet))
      .flatMap((exercise) => exerciseMuscleLookup.get(exercise.exercise_id) ?? [])
      .map((muscle) => [muscle.uiGroup.code, muscle.uiGroup]),
  ).values()].sort((a, b) => a.sourceOrder - b.sourceOrder || a.name.localeCompare(b.name));
  if (uiGroups.length) {
    const pills = document.createElement("span");
    pills.className = "muscle-pill-list";
    for (const group of uiGroups) {
      const pill = document.createElement("span");
      pill.className = `muscle-pill muscle-group-${group.code}`;
      pill.textContent = group.name;
      pills.append(pill);
    }
    copy.append(pills);
  }

  const trailing = document.createElement("span");
  if (session.status === "in_progress") {
    trailing.className = "session-status-badge";
    trailing.textContent = "In progress";
  } else {
    trailing.innerHTML = '<svg class="home-recent-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
  }

  button.setAttribute("aria-label", `${title.textContent}, ${formatDate(session.performed_on)}, ${context.textContent}`);
  button.append(dateBlock, copy, trailing);
  item.append(button);
  return item;
}

async function loadHomeActivity(supabase) {
  if (!homeActivityHeatmap || !homeActivityStatus) return;
  const requestId = ++homeActivityRequestId;
  const requestedUserId = activeUserId;
  const todayIso = toLocalIsoDate();
  if (!homeActivityHeatmap.childElementCount) renderHomeActivity(new Map(), todayIso);
  homeActivityHeatmap.dataset.state = "loading";

  const { data, error } = await supabase
    .from("workout_sessions")
    .select("performed_on, session_exercises(exercise_sets(weight, reps, is_warmup, reported_rir_bucket))")
    .eq("owner_id", requestedUserId)
    .gte("performed_on", activityCalendarStart(todayIso))
    .lte("performed_on", todayIso);

  if (requestId !== homeActivityRequestId || requestedUserId !== activeUserId) return;
  homeActivityHeatmap.dataset.state = "idle";
  if (error) {
    homeActivityStatus.textContent = `Could not load training activity: ${error.message}`;
    homeActivityStatus.hidden = false;
    return;
  }
  renderHomeActivity(countWorkingSetsByDay(data), todayIso);
}

function renderHomeActivity(countsByDay, todayIso) {
  const calendar = buildActivityCalendar(countsByDay, todayIso);
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
  // Keeps month labels from sliding under the pinned weekday column on narrow screens.
  const corner = document.createElement("span");
  corner.className = "activity-weekday activity-corner";
  const cells = [corner];

  for (const { column, month } of calendar.months) {
    const label = document.createElement("span");
    label.className = "activity-month";
    label.style.gridColumn = `${column + 2} / span 3`;
    label.textContent = monthFormat.format(new Date(Date.UTC(2026, month, 1)));
    cells.push(label);
  }
  // Monday-first rows; label every other day like GitHub.
  for (const weekday of [0, 2, 4]) {
    const label = document.createElement("span");
    label.className = "activity-weekday";
    label.style.gridRow = String(weekday + 2);
    label.textContent = weekdayFormat.format(new Date(Date.UTC(2026, 0, 5 + weekday)));
    cells.push(label);
  }
  calendar.columns.forEach((days, column) => {
    for (const day of days) {
      const cell = document.createElement("span");
      cell.className = day.isToday ? "activity-day is-today" : "activity-day";
      cell.dataset.level = String(day.level);
      cell.dataset.count = String(day.count);
      cell.dataset.date = day.iso;
      cell.style.gridColumn = String(column + 2);
      cell.style.gridRow = String(day.weekday + 2);
      cells.push(cell);
    }
  });

  const wasRendered = homeActivityHeatmap.childElementCount > 0;
  homeActivityHeatmap.replaceChildren(...cells);
  const setsLabel = `${calendar.total} working ${calendar.total === 1 ? "set" : "sets"}`;
  const daysLabel = `${calendar.activeDays} training ${calendar.activeDays === 1 ? "day" : "days"}`;
  homeActivitySummary.textContent = `${setsLabel} · ${daysLabel} in the last year`;
  homeActivityHeatmap.setAttribute("aria-label", `Working sets per day since ${formatDate(calendar.startIso)}: ${setsLabel} across ${daysLabel}.`);
  homeActivityStatus.textContent = "Warm-ups and 4+ RIR sets are not counted.";
  homeActivityStatus.hidden = false;
  if (!wasRendered) {
    // Most recent weeks sit on the right; show them first when the grid scrolls.
    const scroller = homeActivityHeatmap.parentElement;
    window.requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }
}

function showHomeActivityTooltip(cell) {
  if (!homeActivityTooltip || !homeActivitySection) return;
  const count = Number(cell.dataset.count);
  const [year, month, day] = cell.dataset.date.split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(year, month - 1, day));
  homeActivityTooltip.replaceChildren();
  const countLabel = document.createElement("strong");
  countLabel.textContent = count ? `${count} working ${count === 1 ? "set" : "sets"}` : "No working sets";
  homeActivityTooltip.append(countLabel, ` on ${dateLabel}`);
  homeActivityTooltip.hidden = false;

  const sectionRect = homeActivitySection.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const halfWidth = homeActivityTooltip.offsetWidth / 2;
  const center = cellRect.left + cellRect.width / 2 - sectionRect.left;
  const left = Math.min(Math.max(center, halfWidth + 8), sectionRect.width - halfWidth - 8);
  homeActivityTooltip.style.left = `${left}px`;
  homeActivityTooltip.style.top = `${cellRect.top - sectionRect.top}px`;
}

function hideHomeActivityTooltip() {
  if (homeActivityTooltip) homeActivityTooltip.hidden = true;
}

homeActivityHeatmap?.addEventListener("pointerover", (event) => {
  const cell = event.target.closest(".activity-day");
  if (cell) showHomeActivityTooltip(cell);
  else hideHomeActivityTooltip();
});
homeActivityHeatmap?.addEventListener("pointerleave", hideHomeActivityTooltip);
homeActivityHeatmap?.parentElement.addEventListener("scroll", hideHomeActivityTooltip, { passive: true });

function setSessionButtonLoading(loading, label = "Loading session…") {
  startSessionButton.disabled = loading;
  if (loading) startSessionButton.textContent = label;
  if (loading && homeHero) homeHero.dataset.state = "loading";
}

function showSessionWorkflowError(message) {
  startSessionStatus.textContent = message;
  startSessionStatus.hidden = false;
}

function clearSessionWorkflowStatus() {
  startSessionStatus.textContent = "";
  startSessionStatus.hidden = true;
  sessionModalStatus.textContent = "";
  sessionModalStatus.hidden = true;
}

async function loadSessions(supabase) {
  if (loadingRows || loadedRows >= totalRows && totalRows !== 0) return;
  const requestVersion = sessionRequestVersion;
  const requestedUserId = activeUserId;
  const requestedSearch = sessionSearchQuery;

  loadingRows = true;
  loadMoreButton.disabled = true;
  datasetStatus.textContent = loadedRows === 0 ? "Loading your sessions…" : `${totalRows.toLocaleString()} workout sessions`;

  let sessionRequest = supabase
    .from("workout_sessions")
    .select(
      `id, performed_on, status, gym_id, gyms(name), session_exercises${requestedSearch ? "!inner" : ""}(id, exercise_id, exercise_order, equipment_id, exercises${requestedSearch ? "!inner" : ""}(name), gym_equipment_id, canonical_equipment_id, equipment_name_snapshot, equipment(id, name, kind), exercise_sets(id, set_number, weight, reps, is_warmup, reported_rir_bucket, rir_source, is_drop_set, is_superset, estimated_1rm_brzycki, estimated_1rm_epley, estimated_1rm_brzycki_rir_adjusted, estimated_1rm_epley_rir_adjusted))`,
      { count: "exact" },
    )
    .eq("owner_id", requestedUserId);

  if (requestedSearch) {
    sessionRequest = sessionRequest.ilike("session_exercises.exercises.name", `%${escapeLikePattern(requestedSearch)}%`);
  }

  sessionRequest = sessionRequest
    .order("performed_on", { ascending: false })
    .order("id", { ascending: false })
    .range(loadedRows, loadedRows + pageSize - 1);

  const [sessionResult, muscleMappingError, bodyWeightStateError] = await Promise.all([
    sessionRequest,
    ensureExerciseMuscleLookup(supabase).then(() => null).catch((error) => error),
    bodyWeightFeature.ensureState().then(() => null).catch((error) => error),
  ]);
  const { data, error, count } = sessionResult;

  if (requestVersion !== sessionRequestVersion || requestedUserId !== activeUserId) return;
  loadingRows = false;

  if (error) {
    datasetStatus.textContent = `Could not load your sessions: ${error.message}`;
    loadMoreButton.hidden = true;
    return;
  }

  totalRows = count ?? data.length;
  appendSessionRows(data);
  loadedRows += data.length;
  datasetStatus.textContent = [
    `${totalRows.toLocaleString()} workout sessions`,
    muscleMappingError ? "Muscle labels unavailable" : null,
    bodyWeightStateError ? "Relative e1RM unavailable" : null,
  ].filter(Boolean).join(" · ");
  loadMoreButton.hidden = loadedRows >= totalRows;
  if (requestedSearch) datasetStatus.textContent = formatSessionResultCount(totalRows, requestedSearch);
  loadMoreButton.disabled = false;
}


function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function formatSessionResultCount(count, query) {
  const label = `${count.toLocaleString()} ${count === 1 ? "workout session" : "workout sessions"}`;
  return query ? `${label} matching "${query}"` : label;
}
function appendSessionRows(rows) {
  const fragment = document.createDocumentFragment();

  for (const session of rows) {
    const item = document.createElement("li");
    item.className = "session-item";

    const disclosure = document.createElement("details");
    disclosure.className = "session-entry";

    const summary = document.createElement("summary");
    summary.className = "session-summary";

    const summaryCopy = document.createElement("div");
    summaryCopy.className = "session-summary-copy";

    const heading = document.createElement("h2");
    heading.textContent = session.status === "in_progress" ? "Workout session" : session.gyms?.name ?? "Gym";

    const exercises = [...session.session_exercises].sort(
      (a, b) => a.exercise_order - b.exercise_order,
    );
    const setSlotCount = exercises.reduce(
      (count, exercise) => count + exercise.exercise_sets.length,
      0,
    );
    const workingSetCount = exercises.reduce(
      (count, exercise) => count + exercise.exercise_sets.filter((set) => (
        isAnalyticalWorkingSet(set)
      )).length,
      0,
    );

    const context = document.createElement("p");
    context.className = "session-context";
    context.textContent = session.status === "in_progress"
      ? `${formatDate(session.performed_on)} · ${exercises.length} exercises · ${setSlotCount} set slots`
      : `${formatDate(session.performed_on)} · ${exercises.length} exercises · ${workingSetCount} working sets`;

    const sessionMuscleViews = createSessionMuscleViews(exercises);

    const exerciseList = document.createElement("ol");
    exerciseList.className = "exercise-list";

    for (const exercise of exercises) {
      exercise.sessionGymId = session.gym_id ?? null;
      exerciseList.append(createExerciseItem(exercise, session.performed_on));
    }

    summaryCopy.append(heading);
    if (session.status === "in_progress") {
      const status = document.createElement("span");
      status.className = "session-status-badge";
      status.textContent = "In progress";
      summaryCopy.append(status);
    }
    summaryCopy.append(context);
    if (sessionMuscleViews) summaryCopy.append(sessionMuscleViews);
    summary.append(summaryCopy);
    disclosure.append(summary, exerciseList);
    item.append(disclosure);
    fragment.append(item);
  }

  liftList.append(fragment);
}

function createMusclePillList(muscles, view, scope) {
  const list = document.createElement("ul");
  list.className = "muscle-pill-list";
  list.dataset.muscleView = view;
  list.hidden = view !== muscleViewMode;
  list.setAttribute(
    "aria-label",
    `${scope} ${view === "ui" ? "simplified muscle groups" : "detailed muscle entities"}`,
  );

  for (const muscle of muscles) {
    const pill = document.createElement("li");
    pill.className = `muscle-pill muscle-group-${muscle.uiGroup.code}`;
    pill.textContent = muscle.name;
    pill.title = view === "detailed" ? `${muscle.uiGroup.name} · ${muscle.name}` : muscle.name;
    list.append(pill);
  }

  return list;
}

function createMuscleViews(muscles, containerClass, scope) {
  const detailedMuscles = [...new Map(
    muscles.map((muscle) => [muscle.name, muscle]),
  ).values()].sort(
    (a, b) => a.sourceOrder - b.sourceOrder || a.name.localeCompare(b.name),
  );
  if (detailedMuscles.length === 0) return null;

  const uiMuscles = [...new Map(
    detailedMuscles.map((muscle) => [muscle.uiGroup.code, {
      name: muscle.uiGroup.name,
      sourceOrder: muscle.uiGroup.sourceOrder,
      uiGroup: muscle.uiGroup,
    }]),
  ).values()].sort(
    (a, b) => a.sourceOrder - b.sourceOrder || a.name.localeCompare(b.name),
  );

  const container = document.createElement("div");
  container.className = containerClass;
  container.append(
    createMusclePillList(uiMuscles, "ui", scope),
    createMusclePillList(detailedMuscles, "detailed", scope),
  );
  return container;
}

function createSessionMuscleViews(exercises) {
  const muscles = exercises.flatMap((exercise) => (
    exercise.exercise_sets.some(isAnalyticalWorkingSet)
      ? exerciseMuscleLookup.get(exercise.exercise_id) ?? []
      : []
  ));
  return createMuscleViews(muscles, "session-muscles", "Session");
}

function createExerciseMuscleViews(exercise) {
  if (!exercise.exercise_sets.some(isAnalyticalWorkingSet)) return null;
  return createMuscleViews(
    exerciseMuscleLookup.get(exercise.exercise_id) ?? [],
    "exercise-muscles",
    "Exercise",
  );
}

function setMuscleViewMode(mode) {
  if (mode !== "ui" && mode !== "detailed") return;
  muscleViewMode = mode;
  for (const list of liftList.querySelectorAll("[data-muscle-view]")) {
    list.hidden = list.dataset.muscleView !== mode;
  }
}

async function ensureExerciseMuscleLookup(supabase) {
  if (exerciseMuscleLookupPromise) return exerciseMuscleLookupPromise;

  exerciseMuscleLookupPromise = (async () => {
    const { data: version, error: versionError } = await supabase
      .from("exercise_muscle_relevance_versions")
      .select("id")
      .eq("is_current", true)
      .single();
    if (versionError) throw versionError;

    const { data: muscles, error: muscleError } = await supabase
      .from("muscles")
      .select("id, name, source_order, ui_muscle_groups(code, name, source_order)")
      .eq("is_active", true)
      .order("source_order", { ascending: true });
    if (muscleError) throw muscleError;

    const coefficients = [];
    const batchSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("exercise_muscle_relevance_coefficients")
        .select("exercise_id, muscle_id, relevance")
        .eq("mapping_version_id", version.id)
        .gt("relevance", 0)
        .order("exercise_id", { ascending: true })
        .order("muscle_id", { ascending: true })
        .range(coefficients.length, coefficients.length + batchSize - 1);
      if (error) throw error;
      coefficients.push(...data);
      if (data.length < batchSize) break;
    }

    const muscleById = new Map(muscles.map((muscle) => [muscle.id, muscle]));
    const lookup = new Map();
    for (const coefficient of coefficients) {
      const muscle = muscleById.get(coefficient.muscle_id);
      if (!muscle?.ui_muscle_groups) continue;
      const mappedMuscles = lookup.get(coefficient.exercise_id) ?? [];
      mappedMuscles.push({
        name: muscle.name,
        sourceOrder: muscle.source_order,
        relevance: Number(coefficient.relevance),
        uiGroup: {
          code: muscle.ui_muscle_groups.code,
          name: muscle.ui_muscle_groups.name,
          sourceOrder: muscle.ui_muscle_groups.source_order,
        },
      });
      lookup.set(coefficient.exercise_id, mappedMuscles);
    }
    exerciseMuscleLookup = lookup;
    return exerciseMuscleLookup;
  })().catch((error) => {
    exerciseMuscleLookupPromise = null;
    throw error;
  });

  return exerciseMuscleLookupPromise;
}

function createExerciseItem(exercise, performedOn) {
  const item = document.createElement("li");
  item.className = "exercise-entry";

  const heading = document.createElement("h3");
  heading.textContent = exercise.exercises.name;

  const headingRow = document.createElement("div");
  headingRow.className = "exercise-heading";
  const editButton = document.createElement("button");
  editButton.className = "exercise-edit-button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  headingRow.append(heading, editButton);

  const context = document.createElement("p");
  context.className = "exercise-context";
  const setCount = exercise.exercise_sets.length;
  const equipmentName = getSessionExerciseEquipmentName(exercise);
  context.textContent = [
    `${setCount} ${setCount === 1 ? "set" : "sets"}`,
    equipmentName,
  ].filter(Boolean).join(" · ");

  const weightUnit = formatWeightUnit(exercise.exercises.name, equipmentName);
  const sets = document.createElement("table");
  sets.className = "set-table";
  const setHead = sets.createTHead().insertRow();
  for (const [className, label, unit] of [
    ["set-number", "Set"],
    ["set-load", "Load", weightUnit],
    ["set-reps", "Reps"],
    ["set-type", "Type"],
  ]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.className = className;
    cell.textContent = label;
    if (unit) {
      const unitLabel = document.createElement("small");
      unitLabel.textContent = unit;
      cell.append(" ", unitLabel);
    }
    setHead.append(cell);
  }
  const setBody = sets.createTBody();

  const muscleViews = createExerciseMuscleViews(exercise);

  for (const set of [...exercise.exercise_sets].sort((a, b) => a.set_number - b.set_number)) {
    const row = setBody.insertRow();
    row.className = `is-${classifySet(set).replace("_", "-")}`;
    const labels = [
      formatSetClassification(set),
      set.is_drop_set ? "Drop set" : null,
      set.is_superset ? "Superset" : null,
    ].filter(Boolean);
    const cells = [
      ["set-number", String(set.set_number)],
      ["set-load", set.weight === null ? "—" : Number(set.weight).toLocaleString()],
      ["set-reps", set.reps === null ? "—" : String(set.reps)],
      ["set-type", labels.join(" · ")],
    ];
    for (const [className, text] of cells) {
      const cell = row.insertCell();
      cell.className = className;
      cell.textContent = text;
    }
  }

  item.append(headingRow, context);
  if (muscleViews) item.append(muscleViews);
  item.append(sets);
  editButton.addEventListener("click", () => {
    showExerciseEditor(item, exercise, performedOn);
  });
  return item;
}

function showExerciseEditor(item, exercise, performedOn) {
  const form = document.createElement("form");
  form.className = "exercise-edit-form";

  const heading = document.createElement("h3");
  heading.textContent = `Edit ${exercise.exercises.name}`;

  const equipmentLabel = document.createElement("label");
  equipmentLabel.className = "exercise-edit-equipment";
  equipmentLabel.textContent = "Machine / Equipment";
  const equipmentInput = document.createElement("select");
  equipmentInput.name = "canonical_equipment_id";
  populateHistoryEquipmentOptions(equipmentInput, exercise, []);
  equipmentLabel.append(equipmentInput);
  void ensureEquipmentCatalogue()
    .then((catalogue) => {
      if (equipmentInput.isConnected) populateHistoryEquipmentOptions(equipmentInput, exercise, catalogue);
    })
    .catch(() => {
      // The current selection stays available even if the catalogue cannot be loaded.
    });

  const setFields = document.createElement("div");
  setFields.className = "exercise-edit-sets";
  const sortedSets = [...exercise.exercise_sets].sort((a, b) => a.set_number - b.set_number);

  for (const set of sortedSets) {
    const row = document.createElement("div");
    row.className = "exercise-edit-set";
    row.dataset.setId = set.id;

    const number = document.createElement("strong");
    number.textContent = `Set ${set.set_number}`;

    const weightLabel = document.createElement("label");
    weightLabel.textContent = `Weight (${formatWeightUnit(exercise.exercises.name, getSessionExerciseEquipmentName(exercise))})`;
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.name = "weight";
    weightInput.min = "0";
    weightInput.step = "any";
    weightInput.inputMode = "decimal";
    weightInput.value = set.weight ?? "";
    weightLabel.append(weightInput);

    const repsLabel = document.createElement("label");
    repsLabel.textContent = "Reps";
    const repsInput = document.createElement("input");
    repsInput.type = "number";
    repsInput.name = "reps";
    repsInput.min = "0";
    repsInput.step = "1";
    repsInput.inputMode = "numeric";
    repsInput.value = set.reps ?? "";
    repsLabel.append(repsInput);

    const warmupLabel = document.createElement("label");
    const warmupInput = document.createElement("input");
    warmupInput.type = "checkbox";
    warmupInput.name = "is_warmup";
    warmupInput.checked = set.is_warmup === true;
    warmupLabel.append(warmupInput, " Warm-up set");

    const rirLabel = document.createElement("label");
    rirLabel.className = "exercise-edit-rir";
    rirLabel.textContent = "Reps in reserve (RIR)";
    const rirSelect = document.createElement("select");
    rirSelect.name = "reported_rir_bucket";
    rirSelect.required = !warmupInput.checked;
    const choices = [["", "Choose RIR"], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4+ — not counted as a working set"]];
    for (const [value, label] of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = set.rir_source === "user_entered" && value !== "" && Number(value) === Number(set.reported_rir_bucket);
      rirSelect.append(option);
    }
    const syncRir = () => {
      rirLabel.hidden = warmupInput.checked;
      rirSelect.required = !warmupInput.checked;
      if (warmupInput.checked) rirSelect.value = "";
    };
    warmupInput.addEventListener("change", syncRir);
    syncRir();
    rirLabel.append(rirSelect);

    row.append(number, weightLabel, repsLabel, warmupLabel, rirLabel);
    setFields.append(row);
  }

  const status = document.createElement("p");
  status.className = "exercise-edit-status";
  status.setAttribute("role", "status");

  const actions = document.createElement("div");
  actions.className = "exercise-edit-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  actions.append(cancelButton, saveButton);

  form.append(heading, equipmentLabel, setFields, status, actions);
  item.replaceChildren(form);
  equipmentInput.focus();

  cancelButton.addEventListener("click", () => {
    item.replaceWith(createExerciseItem(exercise, performedOn));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const setUpdates = sortedSets.map((set) => {
      const row = setFields.querySelector(`[data-set-id="${set.id}"]`);
      const weightInput = row.querySelector('[name="weight"]');
      const repsInput = row.querySelector('[name="reps"]');
      const warmupInput = row.querySelector('[name="is_warmup"]');
      const rirSelect = row.querySelector('[name="reported_rir_bucket"]');
      weightInput.setCustomValidity("");
      repsInput.setCustomValidity("");
      const weight = weightInput.value === "" ? null : Number(weightInput.value);
      const reps = repsInput.value === "" ? null : Number(repsInput.value);
      const isWarmup = warmupInput.checked;
      const reportedRirBucket = isWarmup || rirSelect.value === "" ? null : Number(rirSelect.value);
      return { id: set.id, weight, reps, isWarmup, reportedRirBucket };
    });

    if (!form.reportValidity()) return;
    for (const control of form.elements) control.disabled = true;
    status.textContent = "Saving...";

    try {
      await saveExerciseChanges(exercise, equipmentInput.value ? Number(equipmentInput.value) : null, setUpdates);
      item.replaceWith(createExerciseItem(exercise, performedOn));
      datasetStatus.textContent = "Exercise saved. Estimated 1RM values updated.";
    } catch (error) {
      status.textContent = `Could not save changes: ${error.message}`;
      for (const control of form.elements) control.disabled = false;
    }
  });
}

async function saveExerciseChanges(exercise, equipmentId, setUpdates) {
  if (!supabaseClient || !activeUserId) throw new Error("You are no longer signed in.");
  const requestedUserId = activeUserId;
  const savedCorrection = await persistSessionHistoryExerciseCorrection(
    supabaseClient,
    exercise.id,
    equipmentId,
    setUpdates,
  );
  if (requestedUserId !== activeUserId) throw new Error("Your session changed while saving.");

  exercise.canonical_equipment_id = savedCorrection.canonical_equipment_id;
  exercise.equipment_name_snapshot = savedCorrection.equipment_name_snapshot;
  const savedEquipment = (equipmentCatalogue ?? []).find((equipment) => equipment.id === savedCorrection.canonical_equipment_id);
  exercise.equipment = savedEquipment
    ? { id: savedEquipment.id, name: savedEquipment.name, kind: savedEquipment.kind }
    : (savedCorrection.canonical_equipment_id ? exercise.equipment : null);
  const savedSets = new Map((savedCorrection.sets ?? []).map((set) => [String(set.id), set]));
  for (const set of exercise.exercise_sets) {
    const saved = savedSets.get(String(set.id));
    if (saved) Object.assign(set, saved);
  }
  dashboardFeature.invalidate();
}

function getSessionExerciseEquipmentName(exercise) {
  return exercise.equipment?.name
    || exercise.equipment_name_snapshot
    || (exercise.equipment_id ? `Equipment ${exercise.equipment_id}` : null);
}

async function ensureEquipmentCatalogue() {
  if (equipmentCataloguePromise) return equipmentCataloguePromise;
  const supabase = supabaseClient;
  const requestedUserId = activeUserId;
  if (!supabase || !requestedUserId) return [];
  equipmentCataloguePromise = (async () => {
    const { data, error } = await supabase
      .from("equipment")
      .select("id, name, kind, is_active, equipment_gym_availability(gym_id)")
      .eq("owner_id", requestedUserId)
      .order("name", { ascending: true });
    if (error) throw error;
    if (requestedUserId === activeUserId) equipmentCatalogue = data ?? [];
    return data ?? [];
  })().catch((error) => {
    equipmentCataloguePromise = null;
    throw error;
  });
  return equipmentCataloguePromise;
}

// Session History corrections choose canonical equipment: generic implements and machines available at the
// session's gym first, then every other owned equipment record. The current selection is always kept.
function populateHistoryEquipmentOptions(select, exercise, catalogue) {
  const sessionGymId = exercise.sessionGymId ?? null;
  const currentId = exercise.canonical_equipment_id ? String(exercise.canonical_equipment_id) : "";
  const gymOptions = [];
  const otherOptions = [];
  for (const equipment of catalogue) {
    const usableHere = equipment.kind === "generic"
      || (equipment.equipment_gym_availability || []).some((availability) => String(availability.gym_id) === String(sessionGymId));
    if (equipment.is_active === false && String(equipment.id) !== currentId) continue;
    (usableHere ? gymOptions : otherOptions).push(equipment);
  }

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Not recorded";
  const fragment = document.createDocumentFragment();
  fragment.append(none);
  for (const [label, items] of [["At this gym", gymOptions], ["Other equipment", otherOptions]]) {
    if (!items.length) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const equipment of items) {
      const option = document.createElement("option");
      option.value = String(equipment.id);
      option.textContent = equipment.name;
      group.append(option);
    }
    fragment.append(group);
  }
  if (currentId && !catalogue.some((equipment) => String(equipment.id) === currentId)) {
    const current = document.createElement("option");
    current.value = currentId;
    current.textContent = getSessionExerciseEquipmentName(exercise) ?? "Current equipment";
    fragment.append(current);
  }
  select.replaceChildren(fragment);
  select.value = currentId;
}

function formatOneRepMaxRange(low, high, exerciseName = "", performedOn = null, equipmentName = null) {
  return bodyWeightFeature.formatOneRepMaxRange(low, high, exerciseName, performedOn, equipmentName);
}

function formatWeightUnit(exerciseName, equipmentName = null) {
  return usesPerDumbbellLoad({ equipmentName, exerciseName }) ? "kg per dumbbell" : "kg";
}

function resetSessionResults() {
  sessionRequestVersion += 1;
  equipmentCatalogue = null;
  equipmentCataloguePromise = null;
  loadedRows = 0;
  totalRows = 0;
  loadingRows = false;
  liftList.replaceChildren();
  loadMoreButton.hidden = true;
  loadMoreButton.disabled = false;
  datasetStatus.textContent = sessionSearchQuery ? `Searching for "${sessionSearchQuery}"...` : "Loading your sessions...";
}

function resetLiftList() {
  window.clearTimeout(sessionSearchTimer);
  sessionSearch.value = "";
  sessionSearchQuery = "";
  clearSessionSearchButton.hidden = true;
  resetSessionResults();
  totalRows = 0;
  loadingRows = false;
  liftList.replaceChildren();
  loadMoreButton.hidden = true;
  loadMoreButton.disabled = false;
  datasetStatus.textContent = "Loading your sessions…";
}

function resetActiveSession() {
  activeWorkoutSession = null;
  activeSessionLoadedForUser = null;
  activeSessionLoadingForUser = null;
  setSessionCreationBusy(false);
  closeSessionModal();
  clearSessionWorkflowStatus();
  setSessionButtonLoading(true);
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}
