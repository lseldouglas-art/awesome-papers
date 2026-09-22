export function linkedDiscussionMaterials({result,blockId,question,reply,selectedIds=[]}) {
  const allowed=new Set(selectedIds);
  const citations=reply?.citations ?? (question?.evidence ?? result?.citations?.filter(c=>c.blockId===blockId) ?? []);
  return [...new Set(citations.map(c=>c.accessId).filter(id=>allowed.has(id)))];
}
export function focusedDiscussionContext(context) {
  if(!context)return context;
  return {...context,
    selectedArtifact:{...context.selectedArtifact,blocks:context.target?context.selectedArtifact.blocks.filter(b=>b.id===context.target.blockId):context.selectedArtifact.blocks},
    parentArtifact:context.parentArtifact?{...context.parentArtifact,blocks:[],sourceBoundary:'仅作来路标识，本轮未重新读取来路全文。'}:null,
    discussionBoundary:'本轮只解释当前段落及明确选中的关联材料；未检查其他材料，不能据此判断领域覆盖、创新或没有反例。'};
}
