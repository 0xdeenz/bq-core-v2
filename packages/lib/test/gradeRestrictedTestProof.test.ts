import { 
    buildPoseidon, 
    generateGradeRestrictedTestProof, 
    generateOpenAnswers, 
    hash, 
    rootFromLeafArray, 
    verifyGradeClaimProof,
    verifyTestProof, 
    FullGradeCommitment,
    GradeRestrictedTestFullProof, 
    Poseidon,  
    TestAnswers, 
    TestGradingVariables,
    TestVariables,
    MAX_TREE_DEPTH
} from "@bq-core/lib"
import { Group } from "@semaphore-protocol/group"
import { Identity } from "@semaphore-protocol/identity"
import * as chai from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import { AbiCoder, keccak256 } from "ethers"
import { getCurveFromName } from "ffjavascript"

chai.use(chaiAsPromised)

const abi = new AbiCoder()

const TEST_HEIGHT = 4;

describe("Grade Restricted Test Proof", () => {
    let poseidon: Poseidon

    const gradeClaimThreshold = 80

    const testAnswers: TestAnswers = {
        multipleChoiceAnswers: Array.from({length: 2 ** TEST_HEIGHT}, (_, i) => 1),
        openAnswers: generateOpenAnswers(["chuck's", "feed", "seed"], TEST_HEIGHT)
    }
    let testVariables: TestVariables;

    const externalNullifier = "bq-grade-restricted-test"

    const testSnarkArtifacts = {
        wasmFilePath: `../snark-artifacts/test${TEST_HEIGHT}.wasm`,
        zkeyFilePath: `../snark-artifacts/test${TEST_HEIGHT}.zkey`
    }

    const gradeClaimSnarkArtifacts = {
        wasmFilePath: '../snark-artifacts/gradeClaim.wasm',
        zkeyFilePath: `../snark-artifacts/gradeClaim.zkey`
    }

    let testIdentityGroup = new Group(0, MAX_TREE_DEPTH);
    let testGradeGroup = new Group(0, MAX_TREE_DEPTH);
    let gradeClaimGroup = new Group(0, MAX_TREE_DEPTH);

    const identity = new Identity("deenz")

    const testGradingVariables: TestGradingVariables = {
        multipleChoiceWeight: 40,
        nQuestions: 10
    }
    let gradeCommitment: bigint

    const grade = testGradingVariables.multipleChoiceWeight + 
        Math.floor((100 - testGradingVariables.multipleChoiceWeight) * 
        (testGradingVariables.nQuestions - 1) / testGradingVariables.nQuestions)
    const weightedGrade = grade * testGradingVariables.nQuestions
    let gradeClaimCommitment: FullGradeCommitment

    let gradeRestrictedTestFullProof: GradeRestrictedTestFullProof
    let gradeCommitmentValue: bigint

    let curve: any
    
    const expect = chai.expect

    before(async () => {
        poseidon = await buildPoseidon();

        curve = await getCurveFromName("bn128")

        const _openAnswersHashes = [
            poseidon([hash("sneed's")]), 
            poseidon([hash("feed")]), 
            poseidon([hash("seed")])
        ]
        const openAnswersHashes = Array(2 ** TEST_HEIGHT).fill( poseidon([hash("")]) )
        openAnswersHashes.forEach( (_, i) => { if (i < _openAnswersHashes.length) { openAnswersHashes[i] = _openAnswersHashes[i] }})
        
        testVariables = {
            minimumGrade: 50,
            multipleChoiceWeight: 50, 
            nQuestions: 3,
            multipleChoiceRoot: rootFromLeafArray(poseidon, Array.from({length: 2 ** TEST_HEIGHT}, (_, i) => 1)),
            openAnswersHashesRoot: rootFromLeafArray(poseidon, openAnswersHashes),
            openAnswersHashes
        }

        const expectedGrade = testVariables.multipleChoiceWeight + Math.floor(
            (100 - testVariables.multipleChoiceWeight) * (testVariables.nQuestions - 1) / testVariables.nQuestions
        )
        gradeCommitmentValue = poseidon([poseidon([identity.nullifier, identity.trapdoor]), expectedGrade])

        const gradeClaimCommitmentValue = poseidon([poseidon([identity.nullifier, identity.trapdoor]), weightedGrade])
        gradeClaimGroup.addMembers([BigInt(1), BigInt(2), gradeClaimCommitmentValue])

        gradeClaimCommitment = {
            gradeCommitmentValue: gradeClaimCommitmentValue,
            gradeCommitmentIndex: 2,
            grade
        }
    })

    after(async () => {
        await curve.terminate()
    })

    describe("generateRestrictedTestProof", () => {
        before(async () => {
            gradeRestrictedTestFullProof = await generateGradeRestrictedTestProof(
                identity, testAnswers, testVariables, testIdentityGroup, testGradeGroup, gradeClaimGroup, gradeClaimThreshold, gradeClaimCommitment, true, testSnarkArtifacts, gradeClaimSnarkArtifacts
            )

            testIdentityGroup.updateMember(0, identity.commitment)
            testGradeGroup.updateMember(0, gradeCommitmentValue)
        })

        it("Should generate the grade claim proof with the correct nullifier hash and signal", async () => {
            const expectedNullifierHash = poseidon([hash(externalNullifier), identity.nullifier])

            const expectedSignalPreimage = abi.encode(
                ["uint", "uint", "uint", "uint"], 
                [
                    identity.commitment,
                    testIdentityGroup.root,
                    gradeCommitmentValue,
                    testGradeGroup.root
                ]
            )
            const expectedSignal = BigInt(keccak256(expectedSignalPreimage))

            expect(gradeRestrictedTestFullProof.gradeClaimFullProof.nullifierHash).to.be.equal(expectedNullifierHash.toString())
            expect(gradeRestrictedTestFullProof.gradeClaimFullProof.signal).to.be.equal(expectedSignal)
        })
    })

    describe("Verifying a restricted test proof", () => {
        it("Should verify the grade claim proof", async () => {
            const response = await verifyGradeClaimProof(gradeRestrictedTestFullProof.gradeClaimFullProof)
            expect(response).to.be.true
        })

        it("Should verify the Test proof", async () => {
            const response = await verifyTestProof(gradeRestrictedTestFullProof.testFullProof, TEST_HEIGHT)
            expect(response).to.be.true
        })
    })
})
