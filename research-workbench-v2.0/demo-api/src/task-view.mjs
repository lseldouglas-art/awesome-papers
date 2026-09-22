// Read projection only. The stored input, checkpoints and raw outputs stay intact.
export const taskSummarySql = `json_set(
  json_remove(payload,'$.modelContext','$.input.context','$.input.currentBrief',
    '$.input.recentExchanges','$.input.continuity','$.input.adoptionContext',
    '$.paperBatchRecords','$.investigation.extractionRecords'),
  '$.summaryView',json('true'),
  '$.savedBatchCount',(SELECT count(*) FROM json_each(entities.payload,'$.paperBatchRecords') b WHERE json_extract(b.value,'$.status')='completed')+(SELECT count(*) FROM json_each(entities.payload,'$.investigation.extractionRecords') b WHERE json_extract(b.value,'$.status')='completed'),
  '$.input.materials',json(coalesce((SELECT json_group_array(json_object(
    'accessId',json_extract(m.value,'$.accessId'),'sourceId',json_extract(m.value,'$.sourceId'),
    'ref',json_extract(m.value,'$.ref'),'level',json_extract(m.value,'$.level')))
    FROM json_each(entities.payload,'$.input.materials') m),'[]'))) `;
