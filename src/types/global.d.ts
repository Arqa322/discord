export {};

declare global {
  interface Window {
    pulseDesktop?: {
      getAppInfo: () => Promise<{ version: string; platform: string; isPackaged: boolean }>;
      getSignalingUrl: () => Promise<string>;
      notify: (title: string, body: string) => Promise<boolean>;
      toggleWindow: () => Promise<boolean>;
      getScreenSources: () => Promise<
        Array<{
          id: string;
          name: string;
          displayId: string;
          thumbnail: string;
        }>
      >;
    };
  }
}
