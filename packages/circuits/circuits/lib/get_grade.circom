pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";

template GetGrade(maxQuestions) {
    signal input multipleChoiceResult;
    signal input nCorrectOpenAnswers;

    signal input multipleChoiceWeight;
    signal input nQuestions;

    signal output out;

    component openAnswerComponentPassed = GreaterThan(8);  // Max value is 64 + 64 = 128 < 2**8 - 1 = 255
    openAnswerComponentPassed.in[0] <== nCorrectOpenAnswers + nQuestions;
    openAnswerComponentPassed.in[1] <== maxQuestions;

    signal multipleChoiceContribution <== multipleChoiceResult * multipleChoiceWeight;

    signal openAnswerWeight <== 100 - multipleChoiceWeight;
    signal openAnswerGrade <== nCorrectOpenAnswers + nQuestions - maxQuestions;
    signal weightedOpenAnswerContribution <== openAnswerGrade * openAnswerWeight;
    signal openAnswerContribution <-- weightedOpenAnswerContribution \ nQuestions;
    signal openAnswerContributionRemainder <-- weightedOpenAnswerContribution % nQuestions;
    openAnswerContribution * nQuestions + openAnswerContributionRemainder === weightedOpenAnswerContribution;

    out <== multipleChoiceContribution + openAnswerComponentPassed.out * openAnswerContribution;
}
