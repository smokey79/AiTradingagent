// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * FlashArb — Balancer V2 flash-loan arbitrage executor (2026-09-29, Stage 1).
 *
 * One transaction: borrow `amount` of `token` from the Balancer Vault (0% fee),
 * run the owner-supplied swap calls (e.g. approve + Uniswap swap A->B, then
 * approve + swap B->A on another pool/DEX), repay the Vault, keep the profit.
 * If the result is below `minProfit`, the WHOLE transaction reverts: nothing is
 * lost except gas.
 *
 * Safety:
 *  - Only the deployer (owner) can start a flash loan (execute).
 *  - receiveFlashLoan only accepts calls from the Balancer Vault AND only while
 *    an owner-started loan is in flight. Balancer lets anyone name any
 *    recipient in flashLoan(), so without the inFlight lock a stranger could
 *    make this contract run a loan it didn't ask for.
 *  - Profits stay in the contract until the owner withdraws them.
 *  - minProfit is int256 ONLY so the fork simulation can deliberately accept
 *    a small loss to measure real costs; the bot must always pass minProfit > 0.
 */
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IBalancerVault {
    function flashLoan(address recipient, address[] calldata tokens, uint256[] calldata amounts, bytes calldata userData) external;
}

contract FlashArb {
    address public immutable owner;
    IBalancerVault public immutable vault;
    bool private inFlight;

    event ArbExecuted(address indexed token, uint256 borrowed, int256 profit);

    constructor(address _vault) {
        owner = msg.sender;
        vault = IBalancerVault(_vault);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "FlashArb: not owner");
        _;
    }

    /// Start a flash loan. targets/datas are the swap calls to run while holding the loan.
    function execute(
        address token,
        uint256 amount,
        address[] calldata targets,
        bytes[] calldata datas,
        int256 minProfit
    ) external onlyOwner {
        require(targets.length == datas.length && targets.length > 0, "FlashArb: bad calls");
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        inFlight = true;
        vault.flashLoan(address(this), tokens, amounts, abi.encode(targets, datas, minProfit));
        inFlight = false;
    }

    /// Balancer Vault callback. Runs the swaps, checks profit, repays.
    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external {
        require(msg.sender == address(vault), "FlashArb: caller is not the vault");
        require(inFlight, "FlashArb: loan not started by owner");
        (address[] memory targets, bytes[] memory datas, int256 minProfit) = abi.decode(userData, (address[], bytes[], int256));

        IERC20 t = IERC20(tokens[0]);
        uint256 before = t.balanceOf(address(this)) - amounts[0];   // what we held before the loan arrived

        for (uint256 i = 0; i < targets.length; i++) {
            (bool ok, bytes memory ret) = targets[i].call(datas[i]);
            if (!ok) {
                assembly { revert(add(ret, 32), mload(ret)) }       // bubble up the DEX's own error
            }
        }

        uint256 owed = amounts[0] + feeAmounts[0];
        uint256 bal = t.balanceOf(address(this));
        int256 profit = int256(bal) - int256(owed) - int256(before);
        require(profit >= minProfit, "FlashArb: below minProfit");
        require(t.transfer(address(vault), owed), "FlashArb: repay failed");
        emit ArbExecuted(tokens[0], amounts[0], profit);
    }

    function withdraw(address token, address to) external onlyOwner {
        IERC20 t = IERC20(token);
        require(t.transfer(to, t.balanceOf(address(this))), "FlashArb: withdraw failed");
    }

    function withdrawETH(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "FlashArb: ETH withdraw failed");
    }

    receive() external payable {}
}
