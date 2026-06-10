import type { SourceManifest, TwinProject } from "../types/twin";

export interface AgentMessage {
  role: "user" | "agent";
  text: string;
}

export interface AgentStep {
  label: string;
  status: "done" | "warning" | "next";
  detail: string;
}

export interface AgentRun {
  query: string;
  recognizedAddress: string;
  intent: "preview" | "official_required";
  confidence: "low" | "medium" | "high";
  model?: {
    provider: "local-rule-agent" | "ollama";
    name: string;
    available: boolean;
  };
  messages: AgentMessage[];
  steps: AgentStep[];
  outputLinks: Array<{
    label: string;
    href: string;
    kind: "preview" | "manifest" | "qa" | "data";
  }>;
  twin?: TwinProject;
  manifest?: SourceManifest;
}

const SADANG_PATTERNS = [/사당동\s*317-?6/, /317-6/, /사당로20가길\s*39/, /행복이가득한집/];

function looksLikeSadang(query: string): boolean {
  return SADANG_PATTERNS.some((pattern) => pattern.test(query));
}

function inferIntent(query: string): AgentRun["intent"] {
  return /공식|정밀|측량|법적|pnu|건축물대장|필지|실측/i.test(query) ? "official_required" : "preview";
}

function geocodingDisplay(provider: string): string {
  if (provider === "vworld") return "VWorld 연결";
  if (provider === "nominatim") return "Nominatim 참고";
  return "공식 GIS 미연결";
}

export function runLocalAddressAgent(query: string, twin: TwinProject, manifest: SourceManifest): AgentRun {
  const cleanQuery = query.trim() || "사당동 317-6번지 디지털 트윈 만들어줘";
  const isSadang = looksLikeSadang(cleanQuery);
  const intent = inferIntent(cleanQuery);
  const recognizedAddress = isSadang
    ? `${twin.addresses.parcel_address} / ${twin.addresses.road_address_candidate}`
    : cleanQuery;
  const confidence = isSadang ? manifest.geocoding.confidence : "low";

  const messages: AgentMessage[] = [
    {
      role: "user",
      text: cleanQuery
    },
    {
      role: "agent",
      text: isSadang
        ? "주소 후보를 사당동 317-6 / 사당로20가길 39로 정리했습니다. 지금은 공식 API 키 없이 프리뷰 좌표와 절차적 매스로 생성합니다."
        : "이 주소는 현재 샘플 범위 밖입니다. MVP는 프리뷰 생성 흐름을 보여주되, 정확 좌표와 geometry는 VWorld/Juso/PNU 검증이 필요합니다."
    },
    {
      role: "agent",
      text:
        intent === "official_required"
          ? "정밀/공식 산출 요청으로 감지했습니다. 이 MVP에서는 preview와 official-required 항목을 분리해서 표시합니다."
          : "빠른 프리뷰 요청으로 감지했습니다. 브라우저에서 확인 가능한 3D 매스와 source manifest를 우선 제공합니다."
    }
  ];

  const steps: AgentStep[] = [
    {
      label: "1. 주소 의도 해석",
      status: "done",
      detail: isSadang ? "사당 샘플 주소로 매칭" : "주소 후보만 보존, 공식 geocoder 필요"
    },
    {
      label: "2. 좌표 후보 선택",
      status: confidence === "low" ? "warning" : "done",
      detail: `공간 데이터 ${geocodingDisplay(manifest.geocoding.provider)} / confidence ${confidence}`
    },
    {
      label: "3. 프리뷰 geometry 생성",
      status: "done",
      detail: "대상 건물, 주변 매스, 도로 힌트, 필지 경계 추정"
    },
    {
      label: "4. 신뢰도/출처 기록",
      status: "done",
      detail: "source_manifest.json + qa_report.html"
    },
    {
      label: "5. 공식 데이터 업그레이드",
      status: "next",
      detail: "VWorld/Juso/PNU/건물통합정보 연결 후 official geometry로 교체"
    }
  ];

  return {
    query: cleanQuery,
    recognizedAddress,
    intent,
    confidence,
    model: {
      provider: "local-rule-agent",
      name: "deterministic-preview-agent",
      available: true
    },
    messages,
    steps,
    outputLinks: [
      {
        label: "3D preview.html",
        href: "/src/samples/sadang_317_6/preview.html",
        kind: "preview"
      },
      {
        label: "source_manifest.json",
        href: "/src/samples/sadang_317_6/source_manifest.json",
        kind: "manifest"
      },
      {
        label: "qa_report.html",
        href: "/src/samples/sadang_317_6/qa_report.html",
        kind: "qa"
      },
      {
        label: "twin.json",
        href: "/src/samples/sadang_317_6/twin.json",
        kind: "data"
      }
    ],
    twin: isSadang ? twin : undefined,
    manifest: isSadang ? manifest : undefined
  };
}
