"use client";

import { useCallback, useEffect, useState } from "react";
import type { TutorResponse } from "@/lib/learning/learning-types";

type TutorPayload = {
  enrollment: { id: string; curriculumVersionId: string };
  path: { currentNodeId: string | null; nodes: Array<{ nodeId: string; title: string; status: string; reason: string }> };
  currentNode: {
    clientId: string;
    title: string;
    summary: string;
    learningObjectives: string[];
    completionCriteria: string[];
    prerequisiteClientIds: string[];
    sourceIds: string[];
  } | null;
  progress: Array<{ nodeId: string; status: string; masteryScore: number }>;
  response: TutorResponse;
  sources: Array<{ sourceId: string; chunkId: string; excerpt: string }>;
};

type TutorClientProps = { enrollmentId: string };

export default function TutorClient({ enrollmentId }: TutorClientProps) {
  const [payload, setPayload] = useState<TutorPayload | null>(null);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [assessment, setAssessment] = useState<{
    progress: { status: string; masteryScore: number };
    reason: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<TutorResponse["blocks"]>([]);
  const [streamingProposal, setStreamingProposal] = useState<TutorResponse["progressProposal"]>();

  const send = useCallback(async (nextMessage: string) => {
    setLoading(true);
    setError(null);
    setPayload(null);
    setStreamingBlocks([]);
    setStreamingProposal(undefined);
    try {
      const response = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId, message: nextMessage }),
      });
      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: { message?: string } };
        throw new Error(errorBody.error?.message ?? "Tutor request failed.");
      }
      if (!response.body) throw new Error("Tutor did not return a streaming response.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (!completed) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
          if (eventName && dataLine) {
            const data = JSON.parse(dataLine) as {
              block?: TutorResponse["blocks"][number];
              progressProposal?: TutorResponse["progressProposal"];
              payload?: TutorPayload;
              message?: string;
            };
            if (eventName === "lesson-block" || eventName === "exercise" || eventName === "source") {
              if (data.block) setStreamingBlocks((current) => [...current, data.block!]);
            } else if (eventName === "progress-proposal") {
              setStreamingProposal(data.progressProposal);
            } else if (eventName === "error") {
              throw new Error(data.message ?? "Tutor request failed.");
            } else if (eventName === "complete" && data.payload) {
              setPayload(data.payload);
              completed = true;
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!completed) throw new Error("Tutor stream ended before completion.");
      setStreamingBlocks([]);
      setStreamingProposal(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Tutor request failed.");
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    void send("");
  }, [send]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    setMessage("");
    void send(trimmed);
  }

  const visibleBlocks = payload?.response.blocks ?? streamingBlocks;
  const visibleProposal = payload?.response.progressProposal ?? streamingProposal;
  const currentProgress = payload?.progress.find(
    (entry) => entry.nodeId === payload.currentNode?.clientId,
  );

  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nodeId = payload?.response.currentNodeId;
    if (!nodeId || !answer.trim()) return;
    setError(null);
    try {
      const response = await fetch("/api/tutor/assessments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId, nodeId, answer: { text: answer.trim() } }),
      });
      const body = (await response.json()) as {
        progress?: { status: string; masteryScore: number };
        decision?: { reason: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.progress || !body.decision) {
        throw new Error(body.error?.message ?? "Assessment failed.");
      }
      setAssessment({ progress: body.progress, reason: body.decision.reason });
      setAnswer("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Assessment failed.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[90rem] gap-6 px-6 py-10 text-stone-800">
      <aside className="hidden w-72 shrink-0 rounded-3xl border border-stone-200 bg-white/70 p-5 shadow-sm md:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Learning path</p>
        <div className="mt-5 space-y-2">
          {payload?.path.nodes.filter((node) => node.status !== "locked").map((node) => (
            <div key={node.nodeId} className={`rounded-2xl px-3 py-2 text-sm ${node.nodeId === payload.path.currentNodeId ? "bg-stone-900 text-white" : "bg-stone-100"}`}>
              <div className="font-medium">{node.title}</div>
              <div className="mt-1 text-xs opacity-70">{node.status}</div>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col rounded-3xl border border-stone-200 bg-white/80 p-6 shadow-sm">
        <div className="border-b border-stone-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">BranchMind Tutor</p>
          <h1 className="mt-2 text-2xl font-semibold">{payload?.currentNode?.title ?? "正在准备课程"}</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">{payload?.currentNode?.summary ?? "Tutor 正在读取你的课程版本。"}</p>
        </div>
        <div className="flex-1 space-y-4 py-6">
          {visibleBlocks.map((block, index) => (
            <article key={`${block.type}-${index}`} className="rounded-2xl bg-stone-100 px-4 py-3">
              {block.type === "source" ? <p className="text-xs text-stone-500">课程来源：{block.label}</p> : block.type === "exercise" ? <><p className="whitespace-pre-wrap text-sm leading-7">{block.markdown}</p><p className="mt-2 text-xs text-stone-500">{block.prompt}</p><form onSubmit={submitAnswer} className="mt-3 flex gap-2"><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写下你的回答" className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm" /><button type="submit" className="rounded-xl bg-stone-800 px-3 py-2 text-xs text-white disabled:opacity-40" disabled={!answer.trim()}>提交评估</button></form></> : "markdown" in block ? <p className="whitespace-pre-wrap text-sm leading-7">{block.markdown}</p> : block.type === "code" ? <pre className="overflow-x-auto text-xs"><code>{block.code}</code></pre> : null}
            </article>
          ))}
          {visibleProposal && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm"><p className="font-medium">进度建议（仅供参考）</p><p className="mt-1">建议状态：{visibleProposal.proposedStatus} · 掌握度：{visibleProposal.masteryScore.toFixed(2)}</p><ul className="mt-2 list-disc pl-5 text-xs text-stone-600">{visibleProposal.evidence.map((entry, index) => <li key={`${entry.type}-${index}`}>{entry.summary}</li>)}</ul><p className="mt-2 text-xs text-stone-500">最终结果以服务端评估规则为准。</p></div>}
          {assessment && <div className="rounded-2xl border border-stone-200 bg-emerald-50 px-4 py-3 text-sm"><p>掌握度：{assessment.progress.masteryScore.toFixed(2)} · 状态：{assessment.progress.status}</p><p className="mt-1 text-xs text-stone-600">{assessment.reason}</p></div>}
          {loading && <p className="text-sm text-stone-500">Tutor 正在思考……</p>}
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
        <form onSubmit={submit} className="flex gap-3 border-t border-stone-200 pt-5">
          <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="问 Tutor 一个问题" className="min-w-0 flex-1 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm outline-none ring-stone-400 focus:ring-2" disabled={loading} />
          <button type="submit" className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40" disabled={loading || !message.trim()}>发送</button>
        </form>
      </section>
      <aside className="hidden w-72 shrink-0 space-y-4 rounded-3xl border border-stone-200 bg-white/70 p-5 shadow-sm lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Current node</p>
        <h2 className="mt-3 text-lg font-semibold">{payload?.currentNode?.title ?? "未选择节点"}</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div><p className="text-xs font-semibold text-stone-500">学习目标</p><ul className="mt-1 list-disc pl-5">{payload?.currentNode?.learningObjectives.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><p className="text-xs font-semibold text-stone-500">完成标准</p><ul className="mt-1 list-disc pl-5">{payload?.currentNode?.completionCriteria.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><p className="text-xs font-semibold text-stone-500">前置知识</p><p className="mt-1 text-stone-600">{payload?.currentNode?.prerequisiteClientIds.length ? payload.currentNode.prerequisiteClientIds.join("、") : "无"}</p></div>
          <div><p className="text-xs font-semibold text-stone-500">掌握度</p><p className="mt-1 text-stone-600">{currentProgress ? `${currentProgress.masteryScore.toFixed(2)} · ${currentProgress.status}` : "暂无评估"}</p></div>
          <div><p className="text-xs font-semibold text-stone-500">来源引用</p><ul className="mt-1 space-y-1 text-stone-600">{payload?.sources.filter((source) => payload.currentNode?.sourceIds.includes(source.sourceId)).map((source) => <li key={source.chunkId}>{source.sourceId} · {source.excerpt.slice(0, 80)}</li>)}</ul></div>
        </div>
      </aside>
    </main>
  );
}
