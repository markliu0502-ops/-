interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

interface KakaoLatLngBounds {
  extend(position: KakaoLatLng): void;
}

interface KakaoMap {
  setCenter(position: KakaoLatLng): void;
  setBounds(bounds: KakaoLatLngBounds, padding?: number): void;
  setLevel(level: number): void;
  getLevel(): number;
}

interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}

interface KakaoMaps {
  load(callback: () => void): void;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMap;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  Polyline: new (options: {
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
    map: KakaoMap;
  }) => KakaoOverlay;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    map: KakaoMap;
  }) => KakaoOverlay;
}

interface Window {
  kakao?: { maps: KakaoMaps };
}
