import { BlockQualifiedSubgraph } from "@bq-core/data"
import {
    buildPoseidon,
    decodeTestCredentialData,
    encodeGradeRestrictedTestFullProof,
    encodeCredentialRestrictedTestFullProof,
    encodeTestFullProof,
    generateCredentialRestrictedTestProof,
    generateGradeRestrictedTestProof,
    generateMultipleChoiceAnswers,
    generateRateCredentialIssuerProof,
    generateTestProof,
    generateOpenAnswers,
    hash,
    verifyCredentialOwnershipProof,
    verifyGradeClaimProof,
    verifyTestProof,
    rootFromLeafArray,
    BigNumberish,
    CredentialRestrictedTestFullProof,
    GradeRestrictedTestFullProof,
    Network,
    OpenAnswersResults,
    Options,
    Poseidon,
    RateFullProof,
    SnarkArtifacts,
    TestAnswers,
    TestCredentialData,
    TestFullProof,
    TestVariables,
    DEPLOYED_CONTRACTS
} from "@bq-core/lib"
import { Contract } from "@ethersproject/contracts"
import { 
    AlchemyProvider, 
    AnkrProvider, 
    CloudflareProvider, 
    EtherscanProvider,
    InfuraProvider,
    JsonRpcProvider,
    PocketProvider,
    Provider
} from "@ethersproject/providers"
import { Group } from "@semaphore-protocol/group"
import { Identity } from "@semaphore-protocol/identity"
import { verifyProof } from "@semaphore-protocol/proof"
import CredentialRegistryABI from "./abi/CredentialsRegistryABI.json"

export default class TestCredential {
    #poseidon: Poseidon

    #subgraph: BlockQualifiedSubgraph
    #network: Network

    #credentialId: number
    #testData: TestCredentialData
    #credentialsRegistry: Contract

    #treeDepth: number
    #openAnswersHashes: string[]

    #autotaskWebhook: string

    // Defines the test via its testId and the smart contract that governs it
    // @param testId Test ID of the test we are focused on.
    // @param chainId Chain ID of the network where this bqTest is defined.
    // @param credentialsContractAddress Address of the Credentials smart contract for this chainId.
    private constructor(
        poseidon: Poseidon,
        blockQualifiedSubgraph: BlockQualifiedSubgraph,
        credentialId: number,
        network: Network, 
        testData: TestCredentialData,
        credentialsRegistry: Contract,
        treeDepth: number,
        autotaskWebhook: string,
        openAnswersHashes?: string[] 
    ) {
        this.#poseidon = poseidon
        this.#subgraph = blockQualifiedSubgraph
        this.#credentialId = credentialId
        this.#network = network
        this.#testData = testData
        this.#credentialsRegistry = credentialsRegistry
        this.#treeDepth = treeDepth
        this.#autotaskWebhook = autotaskWebhook
        this.#openAnswersHashes = openAnswersHashes ?? []
    }

    static async init(
        credentialId: number,
        options: Options = {},
        networkOrEthereumURL: Network = "maticmum", 
        openAnswersHashes?: BigNumberish[],
    ) {
        let poseidon = await buildPoseidon();

        let blockQualifiedSubgraph = new BlockQualifiedSubgraph(networkOrEthereumURL)

        switch (networkOrEthereumURL) {
            case "maticmum":
                options.credentialsRegistryAddress = DEPLOYED_CONTRACTS.maticmum.credentialsRegistryAddress
                options.testCredentialType = DEPLOYED_CONTRACTS.maticmum.testCredentialType
                options.autotaskWebhook = DEPLOYED_CONTRACTS.maticmum.autotaskWebhook
                break
            default:
                if (options.credentialsRegistryAddress === undefined) {
                    throw new Error(`You should provide the Credentials Registry contract address for this network`)
                }

                if (options.testCredentialType === undefined) {
                    options.testCredentialType = 0
                }

                options.autotaskWebhook = ""
        }

        let provider: Provider

        switch (options.provider) {
            case "infura":
                provider = new InfuraProvider(networkOrEthereumURL, options.apiKey)
                break
            case "alchemy":
                provider = new AlchemyProvider(networkOrEthereumURL, options.apiKey)
                break
            case "cloudflare":
                provider = new CloudflareProvider(networkOrEthereumURL, options.apiKey)
                break
            case "etherscan":
                provider = new EtherscanProvider(networkOrEthereumURL, options.apiKey)
                break
            case "pocket":
                provider = new PocketProvider(networkOrEthereumURL, options.apiKey)
                break
            case "ankr":
                provider = new AnkrProvider(networkOrEthereumURL, options.apiKey)
                break
            default:
                if (!networkOrEthereumURL.startsWith("http")) {
                    throw new Error(`Provider '${options.provider}' is not supported`)
                }

                provider = new JsonRpcProvider(networkOrEthereumURL)
        }

        const credentialsRegistry = new Contract(options.credentialsRegistryAddress, CredentialRegistryABI, provider)

        const credentialType = await credentialsRegistry.getCredentialType(credentialId)

        if (options.testCredentialType !== credentialType.toNumber()) {
            throw new Error(`Credential #${credentialId} is not a Test Credential`)
        }

        const testData = decodeTestCredentialData(await credentialsRegistry.getCredentialData(credentialId))

        let fullOpenAnswersHashes = new Array(2 ** testData.testHeight).fill(
            poseidon([hash("")])
        );

        if (testData.multipleChoiceWeight !== 100) {  // Open answer hashes need to be provided
            if (openAnswersHashes === undefined) {  
                throw new Error(`Open answers hashes need to be provided for tests that are not multiple choice`)
            }

            if (openAnswersHashes.length !== testData.nQuestions) {  
                throw new Error(`Need to provide an open answer hash for each question`)
            }
        
            fullOpenAnswersHashes.forEach( (_, i) => { if (i < openAnswersHashes.length) {
                fullOpenAnswersHashes[i] = openAnswersHashes[i].toString()
            }});
        }

        const treeDepth = (await credentialsRegistry.getMerkleTreeDepth(3 * credentialId)).toNumber()

        return new TestCredential(
            poseidon,
            blockQualifiedSubgraph,
            credentialId,
            networkOrEthereumURL,
            testData,
            credentialsRegistry,
            treeDepth,
            options.autotaskWebhook,
            fullOpenAnswersHashes,
        )
    }

    gradeSolution(testAnswers: TestAnswers) {
        // Multiple choice answers provided must be numbers and less than 2 ** testHeight in number
        if ( testAnswers.multipleChoiceAnswers.length > 2 ** this.#testData.testHeight ) { 
            throw new RangeError('Surpassed maximum number of answers for a test')
        }
        // All open answers must be provided - even if an empty ""
        if ( this.#testData.multipleChoiceWeight !== 100 && testAnswers.openAnswers.length < this.#testData.nQuestions ) { 
            throw new RangeError('Some questions were left unanswered')
        }
        if ( testAnswers.openAnswers.length > this.#testData.nQuestions ) { 
            throw new RangeError(
                `Answered ${testAnswers.openAnswers.length} questions while the test only has ${this.#testData.nQuestions}`
            )
        }

        // Multiple choice component
        const multipleChoiceResult = this.#getMultipleChoiceResult(testAnswers)
        // Open answer component
        const { resultsArray, openAnswersResult } = this.#getOpenAnswersResult(testAnswers)

        const testResult = multipleChoiceResult + openAnswersResult

        return {
            grade: testResult,
            minimumGrade: this.#testData.minimumGrade,
            pass: testResult >= this.#testData.minimumGrade,
            nQuestions: testAnswers.openAnswers.length,
            multipleChoiceGrade: this.#testData.multipleChoiceWeight === 0 ? 0 : 100 * multipleChoiceResult / this.#testData.multipleChoiceWeight,
            openAnswerGrade: this.#testData.multipleChoiceWeight === 100 ? 0 : 100 * openAnswersResult / (100 - this.#testData.multipleChoiceWeight),
            multipleChoiceWeight: this.#testData.multipleChoiceWeight,
            openAnswerResults: resultsArray,
        }
    }

    async generateSolutionProof(
        identity: Identity, 
        testAnswers: TestAnswers,
        testSnarkArtifacts?: SnarkArtifacts,
        semaphoreSnarkArtifacts?: SnarkArtifacts,
        gradeClaimSnarkArtifacts?: SnarkArtifacts
    ): Promise<TestFullProof | CredentialRestrictedTestFullProof | GradeRestrictedTestFullProof> {
        const grade = this.gradeSolution(testAnswers)

        testAnswers.multipleChoiceAnswers = generateMultipleChoiceAnswers(testAnswers.multipleChoiceAnswers, this.#testData.testHeight)
        testAnswers.openAnswers = generateOpenAnswers(testAnswers.openAnswers, this.#testData.testHeight)

        const identityGroup = new Group(this.#credentialId, this.#treeDepth)
        const gradeGroup = new Group(this.#credentialId, this.#treeDepth)

        const testVariables: TestVariables = {
            ...this.#testData,
            minimumGrade: grade.pass ? this.#testData.minimumGrade : 0,
            openAnswersHashes: this.#openAnswersHashes
        }

        const gradeGroupMembers = await this.#subgraph.getGroupMembers(this.#credentialId, "grade")
        gradeGroup.addMembers(gradeGroupMembers)

        const identityGroupMembers = await this.#subgraph.getGroupMembers(this.#credentialId, grade.pass ? "credentials" : "no-credentials")
        identityGroup.addMembers(identityGroupMembers)

        if (this.#testData.requiredCredentialGradeThreshold !== 0) {  // Grade restricted test

            const treeDepth = (await this.#credentialsRegistry.getMerkleTreeDepth(3 * this.#testData.requiredCredential)).toNumber()
            const requiredCredentialsGradeGroup = new Group(this.#testData.requiredCredential, treeDepth)
            requiredCredentialsGradeGroup.addMembers(await this.#subgraph.getGroupMembers(this.#testData.requiredCredential, "grade"))

            const testData = decodeTestCredentialData(await this.#credentialsRegistry.getCredentialData(this.#testData.requiredCredential))

            return generateGradeRestrictedTestProof(
                identity,
                testAnswers,
                testVariables,
                identityGroup,
                gradeGroup,
                requiredCredentialsGradeGroup,
                this.#testData.requiredCredentialGradeThreshold,
                { multipleChoiceWeight: testData.multipleChoiceWeight, nQuestions: testData.nQuestions },
                grade.pass,
                testSnarkArtifacts,
                gradeClaimSnarkArtifacts                
            )

        } else if (this.#testData.requiredCredential !== 0) {  // Credential restricted test

            const treeDepth = (await this.#credentialsRegistry.getMerkleTreeDepth(3 * this.#testData.requiredCredential)).toNumber()
            const requiredCredentialsGroup = new Group(this.#testData.requiredCredential, treeDepth)
            requiredCredentialsGroup.addMembers(await this.#subgraph.getGroupMembers(this.#testData.requiredCredential, "credentials"))
            
            return generateCredentialRestrictedTestProof(
                identity,
                testAnswers,
                testVariables,
                identityGroup,
                gradeGroup,
                requiredCredentialsGroup,
                grade.pass,
                testSnarkArtifacts,
                semaphoreSnarkArtifacts
            )

        } else {  // Open test

            return generateTestProof(
                identity,
                testAnswers,
                testVariables,
                identityGroup,
                gradeGroup,
                grade.pass,
                testSnarkArtifacts
            )

        }
    }

    async verifySolutionProof(
        proof: TestFullProof | CredentialRestrictedTestFullProof | GradeRestrictedTestFullProof)
    : Promise<boolean> {
        if ("gradeClaimFullProof" in proof) {  // Grade restricted test
            return (await verifyGradeClaimProof(proof.gradeClaimFullProof)) && (await verifyTestProof(proof.testFullProof, this.#testData.testHeight))
        } else if ("semaphoreFullProof" in proof) {  // Credential restricted test
            return (await verifyCredentialOwnershipProof(proof.semaphoreFullProof)) && (await verifyTestProof(proof.testFullProof, this.#testData.testHeight))
        } else {  // Open test
            return verifyTestProof(proof, this.#testData.testHeight)
        }
    }

    async sendSolutionTransaction(
        proof: TestFullProof | CredentialRestrictedTestFullProof | GradeRestrictedTestFullProof
    ): Promise<Response> {
        let credentialUpdate: string
        if ("gradeClaimFullProof" in proof) {  // Grade restricted test
            credentialUpdate = encodeGradeRestrictedTestFullProof(proof)
        } else if ("semaphoreFullProof" in proof) {  // Credential restricted test
            credentialUpdate = encodeCredentialRestrictedTestFullProof(proof)   
        } else {  // Open test
            credentialUpdate = encodeTestFullProof(proof)
        }

        return fetch(this.#autotaskWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                abi: CredentialRegistryABI,
                functionName: "updateCredential",
                functionParameters: [this.#credentialId, credentialUpdate]
            })
        })
    }

    async generateRateIssuerProof(
        identity: Identity, 
        rating: number,
        comment: string,
        semaphoreSnarkArtifacts?: SnarkArtifacts
    ): Promise<RateFullProof> {
        const credentialsGroup = new Group(this.#credentialId, this.#treeDepth)
        const credentialsGroupMembers = await this.#subgraph.getGroupMembers(this.#credentialId, "credentials")
        credentialsGroup.addMembers(credentialsGroupMembers)

        return generateRateCredentialIssuerProof(
            identity,
            credentialsGroup,
            rating,
            comment,
            semaphoreSnarkArtifacts
        )
    }

    async verifyRateIssuerProof(proof: RateFullProof): Promise<boolean> {
        return verifyProof(proof.semaphoreFullProof, this.#treeDepth)
    }

    async sendRateIssuerTransaction(
        proof: RateFullProof
    ): Promise<Response> {
        return fetch(this.#autotaskWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                abi: CredentialRegistryABI,
                functionName: "updateCredential",
                functionParameters: [
                    this.#credentialId,
                    proof.semaphoreFullProof.merkleTreeRoot,
                    proof.semaphoreFullProof.nullifierHash,
                    proof.semaphoreFullProof.proof,
                    proof.rating,
                    proof.comment
                ]
            })
        })
    }

    get testCredentialData(): TestCredentialData {
        return this.#testData
    }

    get requiredCredential(): number {
        return this.#testData.requiredCredential
    }

    get requiredCredentialGradeThreshold(): number {
        return this.#testData.requiredCredentialGradeThreshold
    }

    get admin(): string {
        return this.#testData.admin
    }

    get isValid(): boolean {
        return this.#testData.minimumGrade === 255
    }

    async getMerkleTreeRoot(group: "grade" | "credentials" | "no-credentials") {
        switch (group) {
            case "grade":
                return (await this.#credentialsRegistry.getMerkleTreeRoot(3 * (this.#credentialId - 1) + 1)).toString()
            case "credentials":
                return (await this.#credentialsRegistry.getMerkleTreeRoot(3 * (this.#credentialId - 1) + 2)).toString()
            case "no-credentials":
                return (await this.#credentialsRegistry.getMerkleTreeRoot(3 * (this.#credentialId - 1) + 3)).toString()
        }
    }

    async getNumberOfMerkleTreeLeaves(group: "grade" | "credentials" | "no-credentials") {
        switch (group) {
            case "grade":
                return (await this.#credentialsRegistry.getNumberOfMerkleTreeLeaves(3 * (this.#credentialId - 1) + 1)).toNumber()
            case "credentials":
                return (await this.#credentialsRegistry.getNumberOfMerkleTreeLeaves(3 * (this.#credentialId - 1) + 2)).toNumber()
            case "no-credentials":
                return (await this.#credentialsRegistry.getNumberOfMerkleTreeLeaves(3 * (this.#credentialId - 1) + 3)).toNumber()
        }
    }

    async URI(): Promise<string> {
        return await this.#credentialsRegistry.getCredentialURI(this.#credentialId)
    }

    async averageRating(): Promise<number> {
        return (await this.#credentialsRegistry.getCredentialAverageRating(this.#credentialId)).toNumber()
    }

    #getMultipleChoiceResult({ multipleChoiceAnswers }: TestAnswers): number {
        const answersArray = generateMultipleChoiceAnswers(multipleChoiceAnswers, this.#testData.testHeight)
        
        // Checking if test is passed and returning the result
        return rootFromLeafArray(this.#poseidon, answersArray).toString() === this.#testData.multipleChoiceRoot ? 
            this.#testData.multipleChoiceWeight : 0
    } 

    #getOpenAnswersResult = ({ openAnswers }: TestAnswers): OpenAnswersResults => {
        let nCorrect = 0
        const resultsArray = new Array(openAnswers.length).fill(false)

        for (var i = 0; i < 2 ** this.#testData.testHeight; i++) {
            if ( i < openAnswers.length ) {
                if (this.#poseidon([hash(openAnswers[i])]).toString() === this.#openAnswersHashes[i] ) {
                    nCorrect++
                    resultsArray[i] = true
                }
            } else {
                nCorrect++  // Default hash is always correct, simply filling to 2 ** testHeight
            }
        }

        const openAnswersResult = (nCorrect + this.#testData.nQuestions > 2 ** this.#testData.testHeight) ?  // prevent underflow
            Math.floor((100 - this.#testData.multipleChoiceWeight) * 
            (nCorrect + this.#testData.nQuestions - 2 ** this.#testData.testHeight) / this.#testData.nQuestions)
        :
            0;

        return {
            nCorrect,
            resultsArray,
            openAnswersResult
        }
    }

    // TODO: some other function to get procedurally more rating comments, from latest to earliest or opposite
    // TODO: functions to generate/verify ownership/grade claim proofs, and see if a nullifier was already used
}
