# Block Qualified Contracts

The smart contracts for Block Qualified serve to keep track of the states of different credentials that users generate, integrating within Semaphore to add an additional privacy layer.

At the core of Block Qualified is the [Credential Registry](./credential-registry.md), built to support different kinds of credential types, each with their own behavior. A credential type defines how a certain credential operates: the rules that must be followed to obtain them. Users can define the behavior of their own credential types, link them to the registry, and create and obtain different credentials that follow these set behaviors.

Users can define the behavior own [Credential Manager](./credential-registry.md) by following the standard provided and (optionally) implementing functions of their own. This Credential Manager is then connected to the Credential Registry, which works to integrate all credentials into a single contract.

Block Qualified has native support for the [Test Credential](./test-credential-manager.md). Each Test Credential has a multiple choice question component and an open answer component, with a minimum grade needed to obtain it. Users can gain these credentials by providing proofs of knowledge of their solution. The actual solutions are encoded as part of the proof and thus are kept private, preventing other users from cheating by looking at public on-chain data.

## Credentials.sol

The main smart contract for Block Qualified, [Credentials.sol](../../packages/contracts/contracts/base/Credentials.sol) allows users to create, manage and solve tests.

### Creating a Test

Anyone can create a new Block Qualified Test by calling the `createTest` function inside the smart contract, and providing:
- `minimumGrade`: out of 100, minimum total grade the user must get to obtain the credential.
- `multipleChoiceWeight`: out of 100, contribution of the multiple choice component towards the total grade.
- `nQuestions`: number of open answer questions the test has, up to a maximum of 64 -- must be set to 1 for pure multiple choice tests.
- `timeLimit`: unix time limit after which it is not possible to obtain this credential -- must set 0 for unlimited.
- `multipleChoiceRoot`: root of the correct multiple choice Merkle tree, where each leaf is the correct choice out of the given ones, as covered in [Block Qualified Tests](block-qualified-tests.md).
- `openAnswersHashesRoot`: root of the correct open answers Merkle tree, where each leaf is the hash of the corresponding correct answer, as covered in [Block Qualified Tests](block-qualified-tests.md).
- `testURI`: external resource containing the actual test and more information about the credential.

The resulting test is given a unique `testId`, and the address that made the `createTest` call will be given exclusive admin rights. The function then defines three new on-chain groups:

- The grade Semaphore-like group, that will contain all the grade commitments for every solving attempt, and whose `groupId = 3 ⋅ testId`.
- The credentials Semaphore group, that will contain all the identity commitments of the users that obtain the credential, and whose `groupId = 3 ⋅ testId + 1`.
- The no-credentials Semaphore group, that will contain all the identity commitments of the users that do not obtain the credential, and whose `groupId = 3 ⋅ testId + 2`.

{% hint style="warning" %}
Although these three groups are all given different `groupId`s, they are all constructed using the same `zeroLeaf` for gas saving purposes:

$$
    \texttt{zeroLeaf} = \textrm{keccak256}(\texttt{testId}) >> 8
$$
{% endhint %}

### Solving a Test
To obtain a credential, the user must call the `solveTest` function, providing a valid proof for the [Test circuit](circuits.md#the-test-circuit) that verifies their proof of knowledge of their solution. The user must specify in the `testPassed` boolean parameter for this function if their solution achieves a grade over `minimumGrade` or not.

The way this is enforced is by setting the `testParameters` public signal of the proof: 
- If the user sets `testPassed` to **true**, the public input `testParameters` set when verifying the proof will make it **invalid** if the grade obtained is below `minimumGrade`.
- If the user sets `testPassed` to **false**, the public input `testParamters` will set the `minimumGrade` to 0, so the grade check inside the proof will clear.

{% hint style="warning" %}
This means that a user can potentially provide a passing solution and still decide to add themselves to the no-credentials group.
{% endhint %}

Depending on the value for `testPassed`, the user will get their Semaphore identity commitment added to the credentials group or to the no-credentials group, respectively. Their grade commitment will be added to the grade group either way.

<p align="center">
  <img src="./commitment-diagram.png" width=70% />
</p>

The height of these three trees is set by the `N_LEVELS` parameter, fixed at 16. This gives us a maximum of 65536 leaves.

### Creating Restricted Tests
Credential issuers can choose to restrict their tests to users that either hold or obtained a grade over a certain threshold for another credential. To obtain this credential, users will need to additionally prove that they pass these requirements.

#### Creating a Credential Restricted Test
Anyone can create a new Block Qualified credential restricted test by calling the `createCredentialRestrictedTest` function inside the smart contract. This function is similar to the `createTest` function, but users will have to additionally provide:
- `requiredCredential`: the `testId` of the credential that users must prove ownership of before being able to solve the test.

The resulting test is given a unique `testId`, and defines the same three groups as [`createTest`](#creating-a-test). To gain these credentials, users will first have to prove that they own the `requiredCredential`.

#### Creating a Grade Restricted Test
Anyone can create a new Block Qualified grade restricted test by calling the `createGradeRestrictedTest` function inside the smart contract. This function is similar to the `createCredentialRestrictedTest` function, but users will have to additionally provide:
- `requiredCredentialGradeThreshold`: a minimum grade which users must prove they have obtained on the `requiredCredential` before being able to solve the test.

The resulting test is given a unique `testId`, and defines the same three groups as [`createTest`](#creating-a-test). To gain these credentials, users will first have to prove that they obtained a grade that is above the `requiredCredentialGradeThreshold` for the `requiredCredential`.

{% hint style="info" %}
Note that every user that provides a valid proof via `solveTest` gets their grade commitment added to the grade tree, regardless of whether they obtained the credential or not. This means that some users from the no-credentials group can pass this restriction if the `requiredCredentialGradeThreshold` is set below the `requiredCredential`'s `minimumGrade`.
{% endhint %}

### Solving Restricted Tests
To obtain a restricted credential, besides providing a proof for the [Test circuit](circuits.md#the-test-circuit), users must provide a proof showing that they pass the restrictions.

#### Solving a Credential Restricted Test
To obtain a credential restricted credential, users must call the `solveCredentialRestrictedTest` function, providing a valid proof for the [Test circuit](circuits.md#the-test-circuit) plus an additional [Semaphore proof](https://semaphore.appliedzkp.org/docs/guides/proofs) that verifies that they own the `requiredCredential`.

{% hint style="info" %}
The external nullifier being used to prevent double-signaling is the string `bq-credential-restricted-test`.
{% endhint %}

#### Solving a Grade Restricted Test
To obtain a grade restricted credential, users must call the `solveGradeRestrictedTest` function, providing a valid proof for the [Test circuit](circuits.md#the-test-circuit) plus an additional [grade claim proof](circuits.md#the-grade-claim-circuit) that verifies that they obtained a grade above the `requiredCredentialGradeThreshold` for the `requiredCredential`.

{% hint style="info" %}
The external nullifier being used to prevent double-signaling is the string `bq-grade-restricted-test`.
{% endhint %}

### Rating the Credential Issuer
After generating a valid Semaphore proof that provides a [rating](../guides/functionalities/credential-issuer-rating.md) for the credential issuer, users can publish these directly on-chain by calling the `rateIssuer` function and providing:
- `testId`: the ID of the test they are giving the rating to.
- `rating`: the rating they gave to the credential issuer, which must be less than or equal to 100.
- `comment`: a comment they gave to the credential issuer.
- `proof` and `proofInputs`: the semaphore proof that verifies that they own this credential and is linked to the `rating` and `comment` they provided.

After verifying the proof, the `rating` is recorded on-chain. The average rating for a test can be accessed by calling `getTestAverageRating` and specifying the `testId`. 

{% hint style="info" %}
The external nullifier being used to prevent double-signaling is the string `bq-grade-restricted-test`.
{% endhint %}

### Verifying Credential Ownership Proofs
External contracts can verify credential ownership proofs by calling the `verifyCredentialOwnershipProof` function, providing the `testId` of the credential and a valid [Semaphore proof](https://semaphore.appliedzkp.org/docs/guides/proofs).

### Verifying Grade Claim Proofs
External contracts can verify grade claim proofs by calling the `verifyGradeClaimProof` function, providing the `testId` of the credential and a valid [grade claim proof](circuits.md#the-grade-claim-circuit) that verifies that they obtained a grade above the `gradeThreshold` they specified.

### Verifying a Test
The admin of a test can choose to _verify it_ by providing the open answer hashes needed to solve this test directly on-chain, which is done by calling the function `verifyTest`.

### Invalidating a Test
The admin of a test can choose to invalidate it, so that users can no longer attempt to solve it, by calling the function `invalidateTest`.
