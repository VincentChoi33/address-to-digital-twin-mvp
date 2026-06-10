import { buildPreviewTwin } from "../core/previewTwin";
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

export interface AgentOutputLink {
  label: string;
  href: string;
  kind: "preview" | "manifest" | "qa" | "data";
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
  outputLinks: AgentOutputLink[];
  twin?: TwinProject;
  manifest?: SourceManifest;
}

const SADANG_PATTERNS = [/사당동\s*317-?6/, /317-6/, /사당로20가길\s*39/, /행복이가득한집/];
const DEFAULT_QUERY = "사당동 317-6번지 디지털 트윈 만들어줘";

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

/**
 * Deterministic offline agent. The curated Sadang sample answers Sadang
 * queries; every other Korean address gets a client-generated preview twin
 * (deterministic fallback coordinate + procedural massing) so the full
 * twin → flood-simulation flow works for arbitrary input without any keys.
 */
export function runLocalAddressAgent(
  query: string,
  sampleTwin: TwinProject,
  sampleManifest: SourceManifest
): AgentRun {
  const cleanQuery = query.trim() || DEFAULT_QUERY;
  const isSadang = looksLikeSadang(cleanQuery);
  const intent = inferIntent(cleanQuery);

  const { twin, manifest } = isSadang
    ? { twin: sampleTwin, manifest: sampleManifest }
    : buildPreviewTwin(cleanQuery);

  const recognizedAddress = isSadang
    ? `${twin.addresses.parcel_address} / ${twin.addresses.road_address_candidate}`
    : twin.addresses.parcel_address;
  const confidence = manifest.geocoding.confidence;

  const messages: AgentMessage[] = [
    { role: "user", text: cleanQuery },
    {
      role: "agent",
      text: isSadang
        ? "주소 후보를 사당동 317-6 / 사당로20가길 39로 정리했습니다. 큐레이션된 사당 샘플 트윈을 로드합니다."
        : "공식 API 키 없이 결정적 프리뷰 좌표와 절차적 매스로 즉시 트윈을 생성했습니다. 정확한 좌표·필지·건물 형상은 VWorld/Juso/PNU 검증이 필요합니다."
    },
    {
      role: "agent",
      text:
        intent === "official_required"
          ? "정밀/공식 산출 요청으로 감지했습니다. preview와 official-required 항목을 분리해서 표시합니다."
          : "빠른 프리뷰 요청으로 감지했습니다. 생성된 트윈 위에서 침수 시뮬레이션을 바로 실행할 수 있습니다."
    }
  ];

  const steps: AgentStep[] = [
    {
      label: "1. 주소 의도 해석",
      status: "done",
      detail: isSadang ? "사당 샘플 주소로 매칭" : "주소 후보 보존 + 오프라인 프리뷰 경로 선택"
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
      label: "4. 침수 시뮬 격자 구성",
      status: "done",
      detail: "트윈 건물/도로를 24×24 수문 격자로 래스터화"
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
    outputLinks: [],
    twin,
    manifest
  };
}
