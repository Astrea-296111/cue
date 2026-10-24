'use strict';

const {planInterviewQuestion} = require('./interview-question-planner');

// This bounds optional retrieval work, never the question sent to the model.
// Keep the final asks when a long setup exceeds the local ranking budget.
function boundedRankingText(value, limit = 8000) {
  const text = String(value || '');
  return text.length <= limit ? text : text.slice(0, limit / 4) + '\n' + text.slice(-limit * 3 / 4);
}

function projectQuestionParts(question, resolution = {}) {
  const text = boundedRankingText(question);
  const planned = planInterviewQuestion({text}).subQuestions;
  const bindings = text === String(question || '') ? resolution.subQuestionScopes || [] : [];
  return (planned.length ? planned : [{text}]).slice(0, 12).map(part => {
    const bound = bindings.find(item => item.start === part.start && item.end === part.end);
    return {text:part.text, projectIds:bound?.projectIds || resolution.canonicalProjectIds || resolution.projectIds || [],
      scopes:bound?.scopes || resolution.sourceScopes || resolution.scopes || [],
      generic:bound?.reason === 'generic-question'};
  }).filter(part => part.text && !part.generic);
}

module.exports = {boundedRankingText, projectQuestionParts};
