pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../lib/semaphore_identity.circom";
include "../lib/get_grade.circom";
include "./verify_multiple_choice.circom";
include "./verify_open_answers.circom";

template VerifyMixedTest(testHeight) {
    var maxQuestions = 2**testHeight;

    // Test parameters
    signal input minimumGrade;
    signal input multipleChoiceWeight;
    signal input nQuestions;

    // User's multiple choice answers tree
    signal input multipleChoiceAnswers[maxQuestions];
    // Correct multiple choice answers tree root, given by the smart contract
    signal input multipleChoiceRoot;

    // User's answers tree
    signal input openAnswers[maxQuestions];
    // Correct answers hashes tree
    signal input openAnswersHashes[maxQuestions];
    // Correct answers hashes tree root, given by the smart contract
    signal input openAnswersHashesRoot;

    signal input identityNullifier;
    signal input identityTrapdoor;
    
    signal output testRoot;
    signal output identityCommitment;
    signal output gradeCommitment;

    component verifyMultipleChoice = VerifyMultipleChoice(testHeight);
    verifyMultipleChoice.multipleChoiceRoot <== multipleChoiceRoot;
    for (var i = 0; i < maxQuestions; i++) {
        verifyMultipleChoice.answers[i] <== multipleChoiceAnswers[i];
    }

    component verifyOpenAnswers = VerifyOpenAnswers(testHeight);
    verifyOpenAnswers.answersHashesRoot <== openAnswersHashesRoot;
    for (var i = 0; i < maxQuestions; i++) {
        verifyOpenAnswers.answers[i] <== openAnswers[i];
        verifyOpenAnswers.answersHashes[i] <== openAnswersHashes[i];
    }

    component testGrade = GetGrade(maxQuestions);
    testGrade.multipleChoiceResult <== verifyMultipleChoice.result;
    testGrade.nCorrectOpenAnswers <== verifyOpenAnswers.nCorrect;
    testGrade.multipleChoiceWeight <== multipleChoiceWeight;
    testGrade.nQuestions <== nQuestions; 

    component passedTest = GreaterEqThan(8);  // Max value is 100 
    passedTest.in[0] <== testGrade.out;
    passedTest.in[1] <== minimumGrade;

    passedTest.out === 1;

    component calculateTestRoot = Poseidon(2);
    calculateTestRoot.inputs[0] <== multipleChoiceRoot;
    calculateTestRoot.inputs[1] <== openAnswersHashesRoot;

    component calculateSecret = CalculateSecret();
    calculateSecret.identityNullifier <== identityNullifier;
    calculateSecret.identityTrapdoor <== identityTrapdoor;

    component calculateIdentityCommitment = CalculateIdentityCommitment();
    calculateIdentityCommitment.secret <== calculateSecret.out;

    component calculateGradeCommitment = Poseidon(2);
    calculateGradeCommitment.inputs[0] <== calculateSecret.out;
    calculateGradeCommitment.inputs[1] <== testGrade.out;
    
    testRoot <== calculateTestRoot.out;
    identityCommitment <== calculateIdentityCommitment.out;
    gradeCommitment <== calculateGradeCommitment.out;
}
