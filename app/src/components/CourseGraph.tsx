import React, { useCallback } from 'react';
import ReactFlow, { MiniMap, Controls, Background, useNodesState, useEdgesState, addEdge, Node, Edge } from 'reactflow';

import 'reactflow/dist/style.css';
import { CourseNode, CourseEdge } from '../context/AppDataContext';

interface CourseGraphProps {
  courses: CourseNode[];
  edges: CourseEdge[];
}

// Helper to convert CourseNode and CourseEdge to React Flow format
const getInitialNodes = (courses: CourseNode[]): Node[] => {
  return courses.map(course => ({
    id: course.id,
    position: { x: Math.random() * 500, y: Math.random() * 500 }, // Random initial position
    data: { label: `${course.code} - ${course.title}` },
  }));
};

const getInitialEdges = (edges: CourseEdge[]): Edge[] => {
  return edges.map((edge, index) => ({
    id: `e${index}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    animated: edge.type === 'coreq', // Animate corequisite edges
    style: { stroke: edge.type === 'prereq' ? 'red' : edge.type === 'exclusion' ? 'black' : 'blue' },
  }));
};

const CourseGraph: React.FC<CourseGraphProps> = ({ courses, edges }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(getInitialNodes(courses));
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(getInitialEdges(edges));

  const onConnect = useCallback(
    (params: any) => setRfEdges((eds) => addEdge(params, eds)),
    [setRfEdges],
  );

  return (
    <div style={{ width: '100%', height: '500px' }}>
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <MiniMap />
        <Controls />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
    </div>
  );
};

export default CourseGraph;
