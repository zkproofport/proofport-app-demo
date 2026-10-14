// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Ssiat Seed (SEED)
/// @notice GIWA Sepolia testnet demo token for the fictional Ssiat drop. It has NO monetary value,
///         is not issued or endorsed by GIWA, Upbit or Dojang, and exists only to show a claim flow.
/// @dev Fixed supply: everything is minted once, in the constructor, to `holder` (the drop).
///      There is no mint function, no owner and no admin.
contract SsiatSeed {
    string public constant name = "Ssiat Seed";
    string public constant symbol = "SEED";
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ZeroAddress();
    error ZeroSupply();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address holder, uint256 supply) {
        if (holder == address(0)) revert ZeroAddress();
        if (supply == 0) revert ZeroSupply();
        totalSupply = supply;
        balanceOf[holder] = supply;
        emit Transfer(address(0), holder, supply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            if (approved < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = approved - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
