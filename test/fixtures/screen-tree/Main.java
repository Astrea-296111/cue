import java.util.*;
public class Main {
  static class TreeNode { int num; TreeNode left, right; TreeNode(int n) { num=n; } }
  static void flatten(TreeNode root) {
    for (TreeNode curr=root; curr!=null; curr=curr.right) {
      if (curr.left!=null) {
        TreeNode next=curr.left;
        while (next.right!=null) next=next.right;
        next.right=curr.right; curr.right=curr.left; curr.left=null;
      }
    }
  }
  static void preorder(TreeNode n, List<TreeNode> nodes) {
    if(n==null)return;
    nodes.add(n); preorder(n.left,nodes); preorder(n.right,nodes);
  }
  static void check(TreeNode root) { List<TreeNode> nodes=new ArrayList<>(); preorder(root,nodes); flatten(root); verifyAgainst(root,nodes); }
  static void verifyAgainst(TreeNode root,List<TreeNode> expected) {
    Set<TreeNode> seen=Collections.newSetFromMap(new IdentityHashMap<>()); int i=0;
    for(TreeNode n=root;n!=null;n=n.right) {
      if(!seen.add(n)||n.left!=null||i>=expected.size()||n!=expected.get(i++))throw new AssertionError("invalid tree");
    }
    if(i!=expected.size())throw new AssertionError("lost node");
  }
  public static void main(String[] args) {
    check(null); check(new TreeNode(1));
    TreeNode left=new TreeNode(1),right=new TreeNode(1),mixed=new TreeNode(1),chain=new TreeNode(0),p=chain;
    left.left=new TreeNode(2); left.left.left=new TreeNode(3);
    right.right=new TreeNode(2); right.right.right=new TreeNode(3);
    mixed.left=new TreeNode(2);mixed.right=new TreeNode(5);mixed.left.left=new TreeNode(3);mixed.left.right=new TreeNode(4);mixed.right.right=new TreeNode(6);
    for(int i=1;i<500;i++){p.left=new TreeNode(i);p=p.left;}
    check(left);check(right);check(mixed);check(chain);System.out.println("6 tree cases passed");
  }
}
