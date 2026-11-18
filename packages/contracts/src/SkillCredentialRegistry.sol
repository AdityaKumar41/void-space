// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SkillCredentialRegistry
 * @notice On-chain anchor for VOID·SPACE skill credentials (verification hash + lesson id).
 * Non-transferable credential anchor; revoke is a flag, never a deletion.
 */
contract SkillCredentialRegistry {
    string public constant name = "VOID SPACE Skill Credential";
    string public constant symbol = "VSSC";

    address public owner;
    mapping(address => bool) public publishers;

    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _owners;

    struct CredentialRecord {
        string credentialId;
        string verificationHash;
        string lessonId;
        uint64 mintedAt;
        bool revoked;
    }

    mapping(uint256 => CredentialRecord) private _credentials;
    mapping(bytes32 => uint256) private _credentialTokenIds;
    uint256 private _nextTokenId = 1;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event CredentialMinted(
        uint256 indexed tokenId,
        string credentialId,
        string verificationHash,
        string lessonId,
        uint64 timestamp
    );
    event CredentialRevoked(uint256 indexed tokenId, uint64 timestamp);
    event PublisherUpdated(address indexed publisher, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyPublisher() {
        require(publishers[msg.sender] || msg.sender == owner, "not publisher");
        _;
    }

    constructor() {
        owner = msg.sender;
        publishers[msg.sender] = true;
    }

    function setPublisher(address account, bool allowed) external onlyOwner {
        publishers[account] = allowed;
        emit PublisherUpdated(account, allowed);
    }

    function mintCredential(
        address to,
        string calldata credentialId,
        string calldata verificationHash,
        string calldata lessonId
    ) external onlyPublisher returns (uint256 tokenId) {
        require(to != address(0), "zero to");
        require(bytes(credentialId).length > 0, "empty credential");
        require(bytes(verificationHash).length > 0, "empty hash");
        require(bytes(lessonId).length > 0, "empty lesson");
        bytes32 key = keccak256(bytes(credentialId));
        uint256 existing = _credentialTokenIds[key];
        if (existing != 0) {
            CredentialRecord storage record = _credentials[existing];
            require(!record.revoked, "credential revoked");
            require(
                _owners[existing] == to
                    && keccak256(bytes(record.verificationHash)) == keccak256(bytes(verificationHash))
                    && keccak256(bytes(record.lessonId)) == keccak256(bytes(lessonId)),
                "credential mismatch"
            );
            // Retry evidence refers to the same token and original mint time.
            // No additional ownership or balance mutation occurs.
            emit CredentialMinted(
                existing, credentialId, verificationHash, lessonId, record.mintedAt
            );
            return existing;
        }
        tokenId = _nextTokenId++;
        _credentialTokenIds[key] = tokenId;
        _owners[tokenId] = to;
        _balances[to] += 1;
        _credentials[tokenId] = CredentialRecord({
            credentialId: credentialId,
            verificationHash: verificationHash,
            lessonId: lessonId,
            mintedAt: uint64(block.timestamp),
            revoked: false
        });
        emit Transfer(address(0), to, tokenId);
        emit CredentialMinted(
            tokenId, credentialId, verificationHash, lessonId, uint64(block.timestamp)
        );
    }

    function revokeCredential(uint256 tokenId) external onlyPublisher {
        require(_owners[tokenId] != address(0), "missing");
        _credentials[tokenId].revoked = true;
        emit CredentialRevoked(tokenId, uint64(block.timestamp));
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "missing");
        return o;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function getCredential(uint256 tokenId) external view returns (CredentialRecord memory) {
        require(_owners[tokenId] != address(0), "missing");
        return _credentials[tokenId];
    }
}
