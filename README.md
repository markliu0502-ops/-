# Safe Bike Seoul

서울 따릉이 대여소, Kakao 장소 검색·자동차 경로, 한국도로교통공단의 과거 자전거 사고다발지역, 현재 날씨를 한 화면에서 확인하는 Next.js 웹 앱입니다. 자동차 경로는 자전거 경로로 검증된 것이 아니며, 사고 통계는 실제 안전성을 보장하지 않습니다.

## 로컬 실행

필요 환경: Node.js 20.9 이상, npm.

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

`.env.local`에 아래 키를 설정한 다음 `http://localhost:3000`을 엽니다. 현재 개발 서버를 3003 포트에서 사용한다면 `npm run dev -- --port 3003`으로 실행할 수 있습니다. 키가 없는 API는 앱에서 설정 오류를 표시합니다.

## 환경변수

| 변수 | 용도 | 노출 |
| --- | --- | --- |
| `SEOUL_API_KEY` | 서울 열린데이터광장 따릉이 대여소 API | 서버 전용 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 한국도로교통공단 사고다발지역 API | 서버 전용 |
| `KAKAO_REST_API_KEY` | Kakao Local 검색 및 Mobility Directions API | 서버 전용 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | Kakao 지도 JavaScript SDK | 브라우저에 공개됨; 허용 도메인 제한 필수 |

`DATA_GO_KR_API_KEY`에는 공공데이터포털에서 발급된 디코딩 키를 입력합니다. 날씨는 Open-Meteo를 사용하므로 별도 키가 필요하지 않습니다. `.env.example`에는 실제 인증값을 넣지 마세요. `NEXT_PUBLIC_` 변수는 브라우저 번들에 포함되므로 비밀키로 취급하지 말고 Kakao Developers에서 허용 도메인을 제한하세요.

## GitHub에 업로드

`.gitignore`는 `.env*`, `.vercel`, 빌드 결과와 의존성 폴더를 제외하고, 빈 값만 든 `.env.example`은 허용합니다. 업로드 전 아래 명령으로 로컬 환경 파일이 무시되는지 확인하세요.

```powershell
git check-ignore -v .env.local
git status --short
```

GitHub에서 빈 저장소를 만든 뒤, 이 프로젝트 폴더에서 원격 저장소를 연결하고 업로드합니다. `git status`에 `.env.local` 또는 인증값이 포함된 파일이 없는지 확인한 후 커밋하세요.

```powershell
git remote add origin https://github.com/<OWNER>/safe-bike-seoul.git
git add .
git status --short
git commit -m "Prepare Safe Bike Seoul deployment"
git push -u origin main
```

## Vercel 배포

1. Vercel에서 **Add New → Project**를 선택하고 GitHub 저장소를 가져옵니다.
2. 저장소 루트가 이 프로젝트 폴더라면 **Root Directory**는 `.`으로 둡니다. 프레임워크는 Next.js, 빌드 명령은 `npm run build`(기본값)를 사용합니다.
3. **Project Settings → Environment Variables**에서 위 네 변수를 추가합니다. 서버 전용 세 변수는 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. Production과 Preview 환경에 필요한 변수를 각각 설정합니다.
4. `NEXT_PUBLIC_KAKAO_JS_KEY`는 빌드 시 브라우저 코드에 반영되므로, 설정 또는 변경 뒤 새 배포를 실행합니다.
5. 배포가 완료되면 Vercel의 프로덕션 도메인과 필요한 커스텀 도메인을 Kakao Developers의 Web 플랫폼 허용 도메인에 등록하고 다시 배포해 확인합니다.

## Kakao 허용 도메인 및 API 권한

Kakao Developers에서 앱의 **플랫폼 → Web → 사이트 도메인**에 실제 사용할 origin을 등록합니다. 예를 들어 로컬 개발 주소 `http://127.0.0.1:3003` 및 `http://localhost:3000`, 배포 후 발급되는 `https://<project>.vercel.app`, 그리고 사용할 커스텀 도메인을 등록합니다. 실제 배포 도메인을 확인한 뒤 정확한 주소를 추가하세요. Preview 배포에서 지도 SDK가 필요하면 해당 Preview 도메인도 허용 목록에 추가해야 할 수 있습니다.

지도 JavaScript 키는 `NEXT_PUBLIC_KAKAO_JS_KEY`에, REST 키는 `KAKAO_REST_API_KEY`에 각각 넣습니다. Kakao 앱에서 지도 SDK, Local 및 Mobility Directions API의 사용 설정과 권한을 확인하세요. REST 키에 IP 허용 목록을 사용한다면 로컬 컴퓨터의 IP만으로는 Vercel 함수 요청이 허용되지 않을 수 있습니다. Vercel 실행 환경의 지원되는 고정 송신 IP와 Kakao 허용 목록을 확인하고, 키를 클라이언트 코드에 옮기지 마세요.

## 배포 전 확인

```powershell
npm ci
npm run lint
npx tsc --noEmit
npm run build
```
