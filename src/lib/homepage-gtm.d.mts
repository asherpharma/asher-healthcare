export function legacyBookingDestination(location: Pick<Location, "pathname" | "search" | "hash">): string | null;
export function homepageGtmAllowed(location: Pick<Location, "protocol" | "hostname" | "pathname" | "search" | "hash">, navigator: Navigator & { globalPrivacyControl?: boolean }): boolean;
export function crossesHomepageBoundary(documentPath: string, nextPath: string): boolean;
export function leaveTaggedErrorPage(window: Window): void;
export function installHomepageGtm(window: Window, document: Document, navigator: Navigator): void;
export function createHomepageGtmBootstrap(): string;
