export function publicKeyBytes(key: string): Uint8Array<ArrayBuffer>;
export function usableSubscription(subscription: PushSubscription | null | undefined, key: string, now?: number): boolean;
export function subscriptionDeviceId(subscription: PushSubscription | null | undefined): Promise<string>;
