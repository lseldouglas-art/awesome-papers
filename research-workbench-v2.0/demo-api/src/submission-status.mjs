// A lost HTTP acknowledgement is reconciled by reading, never by starting work.
export async function resolveSubmission(client, projectId, submission, signal) {
  const status = await client.request(`/api/projects/${encodeURIComponent(projectId)}/research-requests/${encodeURIComponent(submission.requestId)}`, {signal});
  if (status?.status === 'accepted' && typeof status.taskId === 'string') return status;
  if (status?.status === 'not_received') return status;
  throw new Error('暂时无法核对发送状态；输入仍保留。');
}
