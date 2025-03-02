// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import "./interfaces/ICredentialManager.sol";
import "./interfaces/ICredentialsRegistry.sol";
import "./interfaces/IGradeClaimVerifier.sol";
import "./libs/Structs.sol";
import { PoseidonT3 } from "./libs/Poseidon.sol";

/// @title CredentialsRegistry
/// @dev Manages credential creation and updating, defining credential managers to handle their behavior.
contract CredentialsRegistry is ICredentialsRegistry {
    uint256 constant MAX_TREE_HEIGHT = 16; 

    /// @dev Gets a credential ID and returns the corresponding credential state
    mapping(uint256 => CredentialState) public credentialStates;

    /// @dev Gets a credential ID and returns the corresponding credential parameters
    mapping(uint256 => CredentialParameters) public credentialParameters;

    /// @dev Gets a credential type and returns the address of the corresponding credential manager
    mapping(uint256 => address) public credentialManagers;
    
    /// @dev Gets a credential ID and returns its URI: 
    /// an external resource containing the actual test and more information about the credential
    mapping(uint256 => string) public credentialURIs;

    /// @dev Gests a credential id and returns the corresponding ratings received
    mapping(uint256 => CredentialRating) public credentialRatings;

    /// @dev SemaphoreVerifier smart contract
    SemaphoreVerifier public immutable semaphoreVerifier;

    /// @dev GradeClaimVerifier smart contract
    IGradeClaimVerifier public immutable gradeClaimVerifier;

    /// @dev Checks if the credential exists
    /// @param credentialId: Id of the credential
    modifier onlyExistingCredentials(uint256 credentialId) {
        if (!_credentialExists(credentialId)) {
            revert CredentialDoesNotExist();
        }
        _;
    }

    /// @dev Initializes the CredentialsRegistry smart contract
    /// @param semaphoreVerifierAddress: contract address of the SemaphoreVerifier contract
    /// @param gradeClaimVerifierAddress: contract address of the SemaphoreVerifier contract
    constructor(
        address semaphoreVerifierAddress,
        address gradeClaimVerifierAddress
    ) {
        semaphoreVerifier = SemaphoreVerifier(semaphoreVerifierAddress);
        gradeClaimVerifier = IGradeClaimVerifier(gradeClaimVerifierAddress);
    }

    /// @dev See {ICredentialHandler-createCredential}
    function createCredential(
        uint256 credentialId,
        uint256 treeDepth,
        uint256 credentialType,
        uint256 merkleTreeDuration,
        bytes calldata credentialData,
        string calldata credentialURI
    ) external override {
        if (credentialParameters[credentialId].treeDepth != 0) {
            revert CredentialIdAlreadyExists();
        }

        // Semaphore supports tree depths from 16 - 32 when generating proofs of inclusion
        // BlockQualified's GradeClaimVerifier only supports a grade tree height of 16, to be increased in the future to 32
        if (treeDepth < 16 || treeDepth > MAX_TREE_HEIGHT) {
            revert InvalidTreeDepth();
        }

        if (credentialManagers[credentialType] == address(0)) {
            revert CredentialTypeDoesNotExist();
        }

        credentialStates[credentialId] = ICredentialManager(credentialManagers[credentialType]).createCredential(
            credentialId,
            treeDepth,
            credentialData
        );

        credentialParameters[credentialId].treeDepth = treeDepth;
        credentialParameters[credentialId].credentialType = credentialType;
        credentialParameters[credentialId].merkleTreeDuration = merkleTreeDuration;

        credentialURIs[credentialId] = credentialURI;

        ICredentialManager(credentialManagers[credentialType]).createCredential(
            credentialId,  // credentialId
            treeDepth,
            credentialData
        );

        emit CredentialCreated(credentialId, credentialType, treeDepth);
    }

    /// @dev See {ICredentialHandler-updateCredential}
    function updateCredential(
        uint256 credentialId,
        bytes calldata credentialUpdate
    ) external override onlyExistingCredentials(credentialId) {
        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];
        
        CredentialState memory currentCredentialState = credentialStates[credentialId];

        CredentialState memory newCredentialState = ICredentialManager(credentialManager).updateCredential(
            credentialId,
            currentCredentialState,
            credentialUpdate
        );

        if (newCredentialState.gradeTreeRoot != currentCredentialState.gradeTreeRoot) {
            credentialParameters[credentialId].merkleRootCreationDates[newCredentialState.gradeTreeRoot] = block.timestamp;
        }

        if (newCredentialState.credentialsTreeRoot != currentCredentialState.credentialsTreeRoot) {
            credentialParameters[credentialId].merkleRootCreationDates[newCredentialState.credentialsTreeRoot] = block.timestamp;
        }

        credentialStates[credentialId] = newCredentialState;
    }

    /// @dev See {ICredentialHandler-invalidateCredential}
    function invalidateCredential(
        uint256 credentialId
    ) external override onlyExistingCredentials(credentialId) {
        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];  

        ICredentialManager(credentialManager).invalidateCredential(credentialId);
    }

    /// @dev See {ICredentialsRegistry-defineCredentialType}
    function defineCredentialType(
        uint256 credentialType,
        address credentialManager
    ) external override {
        if (credentialManagers[credentialType] != address(0)) {
            revert CredentialTypeAlreadyDefined();
        }

        // type(ICredentialManager).interfaceId = 0x41be9068
        if (!ICredentialManager(credentialManager).supportsInterface(0x41be9068)) {
            revert InvalidCredentialManagerAddress();
        }

        credentialManagers[credentialType] = credentialManager;
    }

    /// @dev See {ICredentialsRegistry-rateCredential}
    function rateCredential(
        uint256 credentialId,
        uint256 credentialsTreeRoot,
        uint256 nullifierHash,
        uint256[8] calldata proof,
        uint128 rating,
        string calldata comment
    ) external override onlyExistingCredentials(credentialId) {
        if(rating > 100) {
            revert InvalidRating();
        }

        uint256 signal = uint(keccak256(abi.encode(rating, comment)));

        // formatBytes32String("bq-rate")
        uint256 externalNullifier = 
            0x62712d7261746500000000000000000000000000000000000000000000000000;
        
        _verifyCredentialOwnershipProof(
            credentialId, 
            credentialsTreeRoot, 
            nullifierHash, 
            signal, 
            externalNullifier, 
            proof
        );

        credentialRatings[credentialId].totalRating += rating;
        credentialRatings[credentialId].nRatings++;

        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];

        address credentialAdmin = ICredentialManager(credentialManager).getCredentialAdmin(credentialId);

        emit NewCredentialRating(credentialId, credentialAdmin, rating, comment);
    }

    /// @dev See {ICredentials-verifyCredentialOwnershipProof}
    function verifyCredentialOwnershipProof(
        uint256 credentialId,
        uint256 merkleTreeRoot,
        uint256 nullifierHash,
        uint256 signal,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external override onlyExistingCredentials(credentialId) {
        _verifyCredentialOwnershipProof(credentialId, merkleTreeRoot, nullifierHash, signal, externalNullifier, proof);
    }

    /// @dev See {ICredentials-verifyGradeClaimProof}
    function verifyGradeClaimProof(
        uint256 credentialId,
        uint256 gradeTreeRoot,
        uint256 nullifierHash,
        uint256 gradeThreshold,
        uint256 signal,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external override onlyExistingCredentials(credentialId) {
        if (credentialParameters[credentialId].nullifierHashes[nullifierHash]) {
            revert UsingSameNullifierTwice();
        }

        // voids the nullifier
        credentialParameters[credentialId].nullifierHashes[nullifierHash] = true;

        _verifyMerkleRootValidity(
            credentialId, 
            gradeTreeRoot, 
            credentialStates[credentialId].gradeTreeRoot
        );

        uint256 treeDepth = credentialParameters[credentialId].treeDepth;

        gradeClaimVerifier.verifyProof(
            gradeTreeRoot,
            nullifierHash,
            gradeThreshold,
            signal,
            externalNullifier,
            proof,
            treeDepth
        );    
    }

    /// @dev See {ICredentialHandler-getCredentialData}
    function getCredentialData(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (bytes memory) {
        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];

        return ICredentialManager(credentialManager).getCredentialData(credentialId);
    }

    /// @dev See {ICredentialHandler-getCredentialURI}
    function getCredentialURI(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (string memory) {
        return credentialURIs[credentialId];
    }

    /// @dev See {ICredentialHandler-getCredentialAdmin}
    function getCredentialAdmin(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (address) {
        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];

        return ICredentialManager(credentialManager).getCredentialAdmin(credentialId); 
    }

    /// @dev See {ICredentialRegistry-getCredentialType}
    function getCredentialType(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (uint256) {
        return credentialParameters[credentialId].credentialType;
    }

    /// @dev See {ICredentialRegistry-getCredentialManager}
    function getCredentialManager(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (address) {
        return credentialManagers[credentialParameters[credentialId].credentialType];
    }  

    /// @dev See {ICredentialRegistry-getCredentialAverageRating}
    function getCredentialAverageRating(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns(uint256) {
        uint256 nRatings = credentialRatings[credentialId].nRatings;
        return nRatings == 0 ? nRatings : credentialRatings[credentialId].totalRating / nRatings;
    }

    /// @dev See {ICredentialsRegistry-getMerkleRootCreationDate}
    function getMerkleRootCreationDate(
        uint256 credentialId, 
        uint256 merkleRoot
    ) external view override onlyExistingCredentials(credentialId) returns (uint256 creationDate) {
        creationDate = credentialParameters[credentialId].merkleRootCreationDates[merkleRoot];

        if (creationDate == 0) {
            revert MerkleTreeRootIsNotPartOfTheGroup();
        }
    }

    /// @dev See {ICredentialsRegistry-wasNullifierHashUsed}
    function wasNullifierHashUsed(
        uint256 credentialId, 
        uint256 nullifierHash
    ) external view override onlyExistingCredentials(credentialId) returns (bool) {
        return credentialParameters[credentialId].nullifierHashes[nullifierHash];
    }

    /// @dev See {ICredentialsRegistry-credentialExists}
    function credentialExists(
        uint256 credentialId
    ) external view override returns (bool) {
        return _credentialExists(credentialId);
    }

    /// @dev See {ICredentialsRegistry-credentialIsValid}
    function credentialIsValid(
        uint256 credentialId
    ) external view override onlyExistingCredentials(credentialId) returns (bool) {
        address credentialManager = credentialManagers[credentialParameters[credentialId].credentialType];

        return ICredentialManager(credentialManager).credentialIsValid(credentialId);  
    }

    /// @dev See {ISemaphoreGroups-getMerkleTreeRoot}
    function getMerkleTreeRoot(uint256 groupId) external view override onlyExistingCredentials((groupId + 2) / 3) returns (uint256) {
        uint256 credentialId = (groupId + 2) / 3;
        if (groupId % 3 == 1) {
            return credentialStates[credentialId].gradeTreeRoot;
        } else if (groupId % 3 == 2) {
            return credentialStates[credentialId].credentialsTreeRoot;
        } else {  // groupId % 3 == 0
            return credentialStates[credentialId].noCredentialsTreeRoot;
        }
    }

    /// @dev See {ISemaphoreGroups-getMerkleTreeDepth}
    function getMerkleTreeDepth(uint256 groupId) external view override onlyExistingCredentials((groupId + 2) / 3) returns (uint256) {
        return credentialParameters[(groupId + 2) / 3].treeDepth;
    }
    
    /// @dev See {ISemaphoreGroups-getNumberOfMerkleTreeLeaves}
    function getNumberOfMerkleTreeLeaves(uint256 groupId) external view override onlyExistingCredentials((groupId + 2) / 3) returns (uint256) {
        uint256 credentialId = (groupId + 2) / 3;
        if (groupId % 3 == 1) {
            return uint256(credentialStates[credentialId].gradeTreeIndex);
        } else if (groupId % 3 == 2) {
            return uint256(credentialStates[credentialId].credentialsTreeIndex);
        } else {  // groupId % 3 == 0
            return uint256(credentialStates[credentialId].noCredentialsTreeIndex);
        }
    }

    /// @dev See {ICredentials-verifyCredentialOwnershipProof}
    function _verifyCredentialOwnershipProof(
        uint256 credentialId,
        uint256 merkleTreeRoot,
        uint256 nullifierHash,
        uint256 signal,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) internal {
        if (credentialParameters[credentialId].nullifierHashes[nullifierHash]) {
            revert UsingSameNullifierTwice();
        }
        
        // voids the nullifier
        credentialParameters[credentialId].nullifierHashes[nullifierHash] = true;

        _verifyMerkleRootValidity(
            credentialId, 
            merkleTreeRoot, 
            credentialStates[credentialId].credentialsTreeRoot
        );

        uint256 treeDepth = credentialParameters[credentialId].treeDepth;

        semaphoreVerifier.verifyProof(
            merkleTreeRoot, 
            nullifierHash, 
            signal, 
            externalNullifier, 
            proof, 
            treeDepth
        );
    }

    /// @dev Verifies that the given Merkle root for proof of inclusions is not expired.
    /// This check is made so that proofs can use an old Merkle root, see:
    /// https://github.com/semaphore-protocol/semaphore/issues/98
    function _verifyMerkleRootValidity(
        uint256 credentialId,
        uint256 usedMerkleRoot,
        uint256 currentMerkleRoot
    ) internal view {
        if (usedMerkleRoot != currentMerkleRoot) {
            uint256 merkleRootCreationDate = credentialParameters[credentialId].merkleRootCreationDates[usedMerkleRoot];

            if (merkleRootCreationDate == 0) {
                revert MerkleTreeRootIsNotPartOfTheGroup();
            }

            if (block.timestamp > merkleRootCreationDate + credentialParameters[credentialId].merkleTreeDuration) {
                revert MerkleTreeRootIsExpired();
            }
        }
    }

    /// @dev Returns whether the credential exists
    /// @param credentialId: id of the credential
    /// @return boolean, credential existence
    function _credentialExists(uint256 credentialId) internal view virtual returns (bool) {
        return credentialParameters[credentialId].treeDepth != 0;
    }
}
